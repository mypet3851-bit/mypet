import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import User from '../models/User.js';
// Note: legacy in-memory refreshTokenStore is not suitable for production (restarts/scale);
// we now issue signed JWT refresh tokens stored in HttpOnly cookies.
// revokeUserTokens kept for compatibility when ROTATE_ON_REFRESH is used elsewhere.
import { revokeUserTokens, consumeRefreshToken } from '../utils/refreshTokenStore.js';
import { signUserJwt } from '../utils/jwt.js';
import { normalizePhoneE164ish } from '../utils/phone.js';

function issueTokens(res, userId) {
  const accessToken = signUserJwt(userId, { expiresIn: process.env.ACCESS_TOKEN_TTL || '1h' });
  const refreshTtlDays = parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10);
  const refreshTtlMs = refreshTtlDays * 24 * 60 * 60 * 1000;

  // Stateless refresh token as JWT
  const refreshSecret = process.env.REFRESH_JWT_SECRET || process.env.JWT_SECRET;
  const refreshToken = jwt.sign({ sub: userId.toString(), type: 'refresh' }, refreshSecret, {
    expiresIn: `${refreshTtlDays}d`
  });

  // Allow overriding cookie SameSite via env. For cross-site (Netlify/other -> Render) use SameSite=None; Secure.
  const allowCrossSite = ['1','true','yes','on'].includes(String(process.env.ALLOW_CROSS_SITE_COOKIES || '').toLowerCase());
  let cookieSameSite = (process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax')).toLowerCase();
  if (allowCrossSite) cookieSameSite = 'none';
  const sameSiteValue = ['lax','strict','none'].includes(cookieSameSite) ? cookieSameSite : 'lax';

  res.cookie('rt', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: sameSiteValue,
    maxAge: refreshTtlMs,
    path: '/api/auth'
  });
  return { accessToken, refreshTtlMs };
}

export const promoteToAdmin = async (req, res) => {
  try {
    const { email, secret } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Allow promotion if:
    // 1) No admin exists yet (bootstrap scenario), OR
    // 2) A valid secret token is provided matching ADMIN_SETUP_TOKEN
    const hasAdmin = await User.exists({ role: 'admin' });
    const configuredSecret = process.env.ADMIN_SETUP_TOKEN || '';
    const secretOk = configuredSecret && secret && String(secret) === String(configuredSecret);

    if (!secretOk && hasAdmin) {
      return res.status(403).json({ message: 'Admin already exists. Provide valid secret to promote.' });
    }

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.role = 'admin';
    await user.save();
  return res.json({ ok: true, id: user._id, email: user.email, role: user.role, image: user.image || null });
  } catch (e) {
    console.error('promoteToAdmin error:', e);
    return res.status(500).json({ message: 'Failed to promote user' });
  }
};

export const register = async (req, res) => {
  try {
  const { name, email, password, phoneNumber, region } = req.body;
  const normalizedEmail = String(email || '').toLowerCase();

    // Check if user already exists
  const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Create new user
    const user = new User({
      name,
      email: normalizedEmail,
      password,
      phoneNumber: phoneNumber ? normalizePhoneE164ish(phoneNumber, region) : undefined,
      role: 'user' // Default role
    });

    await user.save();

    // Generate token
    const { accessToken } = issueTokens(res, user._id);

    // Send response
    res.status(201).json({
      token: accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image || null
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
};

export const login = async (req, res) => {
  try {
  const { email, password } = req.body;
  const normalizedEmail = String(email || '').toLowerCase();
    
    // Find user
  const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      // Optional auto-register-on-login feature (disabled by default)
      const autoRegister = String(process.env.AUTO_REGISTER_ON_LOGIN || '').toLowerCase();
      const enabled = ['1','true','yes','on'].includes(autoRegister);
      if (!enabled) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
      // Basic minimum validation before implicit registration
      if (!password || String(password).length < 6) {
        return res.status(400).json({ message: 'Password too short for automatic registration' });
      }
      try {
        const newUser = new User({
          name: normalizedEmail.split('@')[0],
          email: normalizedEmail,
          password,
          role: 'user',
          provider: 'local'
        });
        await newUser.save();
        const { accessToken } = issueTokens(res, newUser._id);
        return res.status(201).json({
          autoRegistered: true,
          token: accessToken,
          user: {
            id: newUser._id,
            name: newUser.name,
            email: newUser.email,
            role: newUser.role,
            image: newUser.image || null
          }
        });
      } catch (e) {
        console.error('Auto-register on login failed:', e);
        return res.status(500).json({ message: 'Failed to auto-register user' });
      }
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate token
    const { accessToken } = issueTokens(res, user._id);

    // Send response
    res.json({
      token: accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image || null
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
};

export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      image: user.image || null
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const isAdmin = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('email role');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json({ isAdmin: user.role === 'admin', email: user.email, role: user.role });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to check admin status' });
  }
};

// POST /api/auth/refresh - rotate refresh token and issue new access
export const refresh = async (req, res) => {
  try {
    if (['1','true','yes','on'].includes(String(process.env.DISABLE_REFRESH_FLOW || '').toLowerCase())) {
      return res.status(400).json({ message: 'Refresh flow disabled' });
    }
    const rt = req.cookies?.rt;
    if (!rt) {
      console.warn('[auth][refresh] 401 missing_cookie origin=', req.headers.origin);
      return res.status(401).json({ message: 'Missing refresh token' });
    }
    // Verify stateless refresh JWT
    let userId;
    try {
      const refreshSecret = process.env.REFRESH_JWT_SECRET || process.env.JWT_SECRET;
      const payload = jwt.verify(rt, refreshSecret);
      if (payload?.type !== 'refresh') throw new Error('invalid_type');
      userId = payload.sub || payload.userId || payload.id;
    } catch (e) {
      // Backward-compat: accept legacy random tokens from in-memory store (until they naturally expire)
      const legacy = consumeRefreshToken(rt);
      if (!legacy) {
        console.warn('[auth][refresh] 401 jwt_invalid_or_expired origin=', req.headers.origin, ' err=', e?.message || e);
        return res.status(401).json({ message: 'Invalid or expired refresh token' });
      }
      userId = legacy.userId;
    }
    const user = await User.findById(userId);
    if (!user) {
      console.warn('[auth][refresh] 401 user_not_found userId=', userId);
      return res.status(401).json({ message: 'User no longer exists' });
    }
    // rotate: revoke user's old tokens if ROTATE_ON_REFRESH=1
    if (process.env.ROTATE_ON_REFRESH === '1') {
      try { revokeUserTokens(user._id.toString()); } catch {}
    }
    const { accessToken } = issueTokens(res, user._id);
    return res.json({ token: accessToken, user: { id: user._id, name: user.name, email: user.email, role: user.role, image: user.image || null } });
  } catch (e) {
    console.error('Refresh error:', e);
    return res.status(500).json({ message: 'Failed to refresh session' });
  }
};

// POST /api/auth/logout - clear cookie and revoke tokens
export const logout = async (req, res) => {
  try {
    const rt = req.cookies?.rt;
    if (rt) {
      revokeUserTokens(req.user?._id?.toString() || '');
      res.clearCookie('rt', { path: '/api/auth' });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: true });
  }
};

// POST /api/auth/check-identifier { identifier }
// Checks whether an email or phone number already exists. Returns { exists: boolean, type: 'email'|'phone'|'unknown' }
export const checkIdentifier = async (req, res) => {
  try {
    const raw = String(req.body?.identifier || '').trim();
    const region = String(req.body?.region || '').trim() || undefined;
    if (!raw) return res.status(400).json({ message: 'identifier is required' });
    const emailRegex = /^\S+@\S+\.\S+$/;
    const phoneRegex = /^\+?[1-9]\d{6,15}$/; // simple E.164ish
    let type = 'unknown';
    let exists = false;
    if (emailRegex.test(raw)) {
      type = 'email';
      const user = await User.findOne({ email: raw.toLowerCase() }).select('_id');
      exists = !!user;
    } else if (phoneRegex.test(raw)) {
      type = 'phone';
      const normalized = normalizePhoneE164ish(raw, region);
      const user = await User.findOne({ phoneNumber: normalized }).select('_id');
      exists = !!user;
    } else {
      // Try coercing to phone digits and re-check
      const digits = normalizePhoneE164ish(raw, region);
      if (phoneRegex.test(digits)) {
        type = 'phone';
        const user = await User.findOne({ phoneNumber: digits }).select('_id');
        exists = !!user;
      }
    }
    return res.json({ exists, type });
  } catch (e) {
    return res.status(500).json({ message: 'Check failed' });
  }
};