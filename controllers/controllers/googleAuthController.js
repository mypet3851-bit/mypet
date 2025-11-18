import { OAuth2Client } from 'google-auth-library';
import User from '../models/User.js';
import { signUserJwt } from '../utils/jwt.js';
import jwt from 'jsonwebtoken';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


// POST /api/auth/google
// Body: { credential: string } from Google Identity Services one-tap / button
export const googleAuth = async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) {
      return res.status(400).json({ message: 'Missing Google credential' });
    }

    // Verify token with Google
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(401).json({ message: 'Invalid Google token' });
    }

    const googleId = payload.sub;
    const email = (payload.email || '').toLowerCase();
    const name = payload.name || payload.given_name || 'User';
    const picture = payload.picture;

    if (!email) {
      return res.status(400).json({ message: 'Google account missing email (possibly unverified)' });
    }

    let user = await User.findOne({ $or: [ { googleId }, { email } ] });

    if (!user) {
      // Create new OAuth user (no password)
      user = new User({
        name,
        email,
        provider: 'google',
        googleId,
        image: picture,
        role: 'user',
        lastLoginAt: new Date()
      });
      await user.save();
    } else {
      // Update any changed profile info & google linkage
      let modified = false;
      if (!user.googleId) { user.googleId = googleId; modified = true; }
      if (picture && picture !== user.image) { user.image = picture; modified = true; }
      if (user.provider !== 'google') { user.provider = 'google'; modified = true; }
      user.lastLoginAt = new Date();
      if (modified) await user.save(); else await user.updateOne({ lastLoginAt: user.lastLoginAt });
    }

    // Access token (short-lived) and refresh token (longer-lived) for persistence
    const accessTtl = 60 * 60; // 1h seconds
    const accessToken = signUserJwt(user._id, { expiresIn: '1h' });
    const refreshTtlDays = parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10);
    const refreshTtlMs = refreshTtlDays * 24 * 60 * 60 * 1000;
    const refreshSecret = process.env.REFRESH_JWT_SECRET || process.env.JWT_SECRET;
    const refreshToken = jwt.sign({ sub: user._id.toString(), type: 'refresh' }, refreshSecret, { expiresIn: `${refreshTtlDays}d` });

    // Cookie options aligned with authController.issueTokens (cross-site friendly when enabled)
    const allowCrossSite = ['1','true','yes','on'].includes(String(process.env.ALLOW_CROSS_SITE_COOKIES || '').toLowerCase());
    let cookieSameSite = (process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax')).toLowerCase();
    if (allowCrossSite) cookieSameSite = 'none';
    const sameSiteValue = ['lax','strict','none'].includes(cookieSameSite) ? cookieSameSite : 'lax';

    // Send refresh token as HttpOnly cookie
    res.cookie('rt', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: sameSiteValue,
      maxAge: refreshTtlMs,
      path: '/api/auth'
    });

    return res.json({
      token: accessToken,
      expiresIn: accessTtl,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image || null,
        provider: user.provider
      }
    });
  } catch (error) {
    console.error('Google auth error:', error);
    return res.status(500).json({ message: 'Google authentication failed' });
  }
};
