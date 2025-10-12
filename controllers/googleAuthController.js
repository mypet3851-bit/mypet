import { OAuth2Client } from 'google-auth-library';
import User from '../models/User.js';
import { signUserJwt } from '../utils/jwt.js';
import crypto from 'crypto';
import { saveRefreshToken } from '../utils/refreshTokenStore.js';

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
    const accessTtl = 60 * 60; // 1h seconds (jwt lib uses human string but we'll sign with default 7d earlier; we override)
    const accessToken = signUserJwt(user._id, { expiresIn: '1h' });
    const refreshTtlDays = parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10);
    const refreshTtlMs = refreshTtlDays * 24 * 60 * 60 * 1000;
    const refreshToken = crypto.randomBytes(48).toString('hex');
    saveRefreshToken(refreshToken, user._id.toString(), refreshTtlMs);

    // Send refresh token as HttpOnly cookie
    res.cookie('rt', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
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
