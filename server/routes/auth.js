// ─── server/routes/auth.js ────────────────────────────────────────────
// Authentication routes: register, login, logout, refresh, me
import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
import { UserStore, TokenStore } from '../services/userStore.js';
import { authLimiter, verifyCsrfToken } from '../middleware/security.js';
import { requireAuth } from '../middleware/authenticate.js';
import { sendWelcomeEmail } from '../services/email.js';

const router = Router();

// ─── Token Factory ────────────────────────────────────────────────────
function createTokens(user) {
  const jti = uuidv4(); // Unique token ID for blacklisting

  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, name: user.name, jti },
    config.jwt.accessSecret,
    {
      expiresIn:  config.jwt.accessExpiry,
      algorithm:  'HS256',
      issuer:     'appleverse-api',
      audience:   'appleverse-client',
    }
  );

  const refreshToken = jwt.sign(
    { sub: user.id, jti: uuidv4() },
    config.jwt.refreshSecret,
    {
      expiresIn:  config.jwt.refreshExpiry,
      algorithm:  'HS256',
      issuer:     'appleverse-api',
      audience:   'appleverse-client',
    }
  );

  // Persist refresh token
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  TokenStore.saveRefreshToken(user.id, refreshToken, expiresAt);

  return { accessToken, refreshToken };
}

function setRefreshCookie(res, token) {
  res.cookie('__refresh_token', token, {
    ...config.cookie,
    path: '/api/auth', // Only sent to auth routes
  });
}

// ─── Validation Rules ─────────────────────────────────────────────────
const registerRules = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 60 })
    .withMessage('Name must be 2–60 characters.')
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage('Name can only contain letters, spaces, hyphens, and apostrophes.'),

  body('email')
    .trim()
    .normalizeEmail()
    .isEmail()
    .withMessage('Please enter a valid email address.')
    .isLength({ max: 254 })
    .withMessage('Email too long.'),

  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be 8–128 characters.')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter.')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter.')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number.')
    .matches(/[^A-Za-z0-9]/)
    .withMessage('Password must contain at least one special character.'),
];

const loginRules = [
  body('email')
    .trim()
    .normalizeEmail()
    .isEmail()
    .withMessage('Invalid email address.'),
  body('password')
    .notEmpty()
    .withMessage('Password is required.')
    .isLength({ max: 128 })
    .withMessage('Password too long.'),
];

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      fields: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  return null;
}

// ─── POST /api/auth/register ──────────────────────────────────────────
router.post('/register', authLimiter, verifyCsrfToken, registerRules, async (req, res) => {
  const validationErr = handleValidation(req, res);
  if (validationErr) return;

  try {
    const { name, email, password } = req.body;

    // Check for existing user — timing-safe (always hash even if user exists)
    const existing = UserStore.findByEmail(email);
    const hash = await bcrypt.hash(password, config.bcrypt.saltRounds);

    if (existing) {
      // Don't reveal whether email exists — return generic success
      return res.status(201).json({
        message: 'If this email is not registered, you will receive a confirmation shortly.',
        code: 'REGISTER_SUCCESS',
      });
    }

    const user = UserStore.create({ name, email, passwordHash: hash });
    const { accessToken, refreshToken } = createTokens(user);

    setRefreshCookie(res, refreshToken);

    console.log(`[auth] New registration: ${user.email} (ID: ${user.id})`);

    // Send welcome email in background
    sendWelcomeEmail(user).catch(mailErr => {
      console.error('[auth/register] Welcome email failed:', mailErr);
    });

    return res.status(201).json({
      message: 'Account created successfully.',
      code: 'REGISTER_SUCCESS',
      accessToken,
      user: UserStore.toPublic(user),
    });
  } catch (err) {
    console.error('[auth/register]', err);
    return res.status(500).json({ error: 'Registration failed. Please try again.', code: 'INTERNAL_ERROR' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────
router.post('/login', authLimiter, verifyCsrfToken, loginRules, async (req, res) => {
  const validationErr = handleValidation(req, res);
  if (validationErr) return;

  try {
    const { email, password } = req.body;
    const user = UserStore.findByEmail(email);

    if (user && UserStore.isLocked(user)) {
      const lockExpiry = new Date(user.lockedUntil);
      const minutesLeft = Math.ceil((lockExpiry - Date.now()) / 60000);
      console.warn(`[auth] Locked account login attempt: ${email}`);
      return res.status(423).json({
        error: `Account temporarily locked due to too many failed attempts. Try again in ${minutesLeft} minute(s).`,
        code: 'ACCOUNT_LOCKED',
        lockedUntil: user.lockedUntil,
      });
    }

    // Always run bcrypt to prevent timing attacks
    const dummyHash = '$2a$12$dummy.hash.to.prevent.timing.attacks.dummy.here..';
    const passwordToCheck = user ? user.passwordHash : dummyHash;
    const isPasswordValid = await bcrypt.compare(password, passwordToCheck);

    if (!user || !isPasswordValid) {
      // Record failed attempt (if user exists)
      if (user) {
        UserStore.recordFailedLogin(user.id, config.lockout.maxAttempts, config.lockout.durationMs);
      }
      console.warn(`[auth] Failed login attempt for: ${email} from IP: ${req.ip}`);
      return res.status(401).json({
        error: 'Invalid email or password.',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Successful login
    UserStore.recordSuccessfulLogin(user.id);
    const { accessToken, refreshToken } = createTokens(user);
    setRefreshCookie(res, refreshToken);

    console.log(`[auth] Successful login: ${user.email} (ID: ${user.id})`);

    return res.status(200).json({
      message: 'Login successful.',
      code: 'LOGIN_SUCCESS',
      accessToken,
      user: UserStore.toPublic(user),
    });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'Login failed. Please try again.', code: 'INTERNAL_ERROR' });
  }
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies['__refresh_token'];

  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token.', code: 'UNAUTHORIZED' });
  }

  try {
    const payload = jwt.verify(refreshToken, config.jwt.refreshSecret, {
      algorithms: ['HS256'],
      issuer: 'appleverse-api',
      audience: 'appleverse-client',
    });

    // Verify token exists in store (prevents reuse after logout)
    const stored = TokenStore.findRefreshToken(refreshToken);
    if (!stored) {
      // Possible token reuse attack — clear all sessions for this user
      TokenStore.removeAllForUser(payload.sub);
      console.warn(`[auth] Refresh token reuse detected for user: ${payload.sub}`);
      res.clearCookie('__refresh_token', { path: '/api/auth' });
      return res.status(401).json({ error: 'Token reuse detected. Please log in again.', code: 'TOKEN_REUSE' });
    }

    const user = UserStore.findById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: 'User not found.', code: 'USER_NOT_FOUND' });
    }

    // Token rotation — issue new pair, invalidate old refresh token
    TokenStore.removeRefreshToken(refreshToken);
    const { accessToken, refreshToken: newRefreshToken } = createTokens(user);
    setRefreshCookie(res, newRefreshToken);

    return res.status(200).json({
      accessToken,
      user: UserStore.toPublic(user),
    });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      res.clearCookie('__refresh_token', { path: '/api/auth' });
      return res.status(401).json({ error: 'Invalid or expired refresh token.', code: 'TOKEN_INVALID' });
    }
    console.error('[auth/refresh]', err);
    return res.status(500).json({ error: 'Token refresh failed.', code: 'INTERNAL_ERROR' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────
router.post('/logout', requireAuth, verifyCsrfToken, (req, res) => {
  try {
    // Blacklist the current access token
    const decoded = jwt.decode(req.cookies['__access_token'] || req.headers.authorization?.slice(7) || '');
    if (decoded?.jti && decoded?.exp) {
      TokenStore.blacklistToken(decoded.jti, new Date(decoded.exp * 1000).toISOString());
    }

    // Invalidate refresh token
    const refreshToken = req.cookies['__refresh_token'];
    if (refreshToken) TokenStore.removeRefreshToken(refreshToken);

    // Clear cookies
    res.clearCookie('__refresh_token', { path: '/api/auth' });
    res.clearCookie('__access_token');

    console.log(`[auth] Logout: ${req.user.email}`);
    return res.status(200).json({ message: 'Logged out successfully.', code: 'LOGOUT_SUCCESS' });
  } catch (err) {
    console.error('[auth/logout]', err);
    return res.status(500).json({ error: 'Logout failed.', code: 'INTERNAL_ERROR' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const user = UserStore.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.', code: 'NOT_FOUND' });
  return res.status(200).json({ user: UserStore.toPublic(user) });
});

// ─── GET /api/auth/csrf ───────────────────────────────────────────────
// Endpoint for clients to get a fresh CSRF token
router.get('/csrf', (req, res) => {
  const token = req.csrfToken || '';
  return res.status(200).json({ csrfToken: token });
});

export default router;
