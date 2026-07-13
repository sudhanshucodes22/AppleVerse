// ─── server/middleware/authenticate.js ───────────────────────────────
// JWT verification middleware — protects API routes
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { TokenStore } from '../services/userStore.js';

/**
 * Extracts JWT from:
 *  1. Authorization: Bearer <token> header (primary)
 *  2. __access_token cookie (fallback for browser clients)
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (req.cookies && req.cookies['__access_token']) {
    return req.cookies['__access_token'];
  }
  return null;
}

/**
 * Mandatory auth — rejects request if not authenticated.
 * Attaches req.user = { id, email, name } on success.
 */
export function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      error: 'Authentication required.',
      code: 'UNAUTHORIZED',
    });
  }

  try {
    const payload = jwt.verify(token, config.jwt.accessSecret, {
      algorithms: ['HS256'],
      issuer: 'appleverse-api',
      audience: 'appleverse-client',
    });

    // Check if this token has been explicitly blacklisted (logged out)
    if (TokenStore.isBlacklisted(payload.jti)) {
      return res.status(401).json({
        error: 'Token has been revoked. Please log in again.',
        code: 'TOKEN_REVOKED',
      });
    }

    req.user = {
      id:    payload.sub,
      email: payload.email,
      name:  payload.name,
      jti:   payload.jti,  // Store jti for logout blacklisting
    };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        error: 'Access token expired.',
        code: 'TOKEN_EXPIRED',
        hint: 'Call /api/auth/refresh to get a new access token.',
      });
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        error: 'Invalid token.',
        code: 'TOKEN_INVALID',
      });
    }
    console.error('[auth] Unexpected JWT error:', err);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
}

/**
 * Optional auth — attaches req.user if valid token present,
 * but does NOT block the request if token is missing/invalid.
 */
export function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const payload = jwt.verify(token, config.jwt.accessSecret, {
      algorithms: ['HS256'],
      issuer: 'appleverse-api',
      audience: 'appleverse-client',
    });
    if (!TokenStore.isBlacklisted(payload.jti)) {
      req.user = { id: payload.sub, email: payload.email, name: payload.name, jti: payload.jti };
    }
  } catch {
    // Silently ignore invalid tokens for optional auth
  }
  next();
}
