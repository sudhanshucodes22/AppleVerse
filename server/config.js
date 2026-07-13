// ─── server/config.js ────────────────────────────────────────────────
// Central configuration — all env vars validated at startup
import 'dotenv/config';
import { randomBytes } from 'crypto';

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.warn(`[config] WARNING: ${name} not set — using generated fallback (not suitable for production)`);
    return randomBytes(64).toString('hex');
  }
  return value;
}

export default {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  jwt: {
    accessSecret:  required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessExpiry:  process.env.JWT_ACCESS_EXPIRY  || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  bcrypt: {
    saltRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  },

  rateLimit: {
    auth: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.AUTH_RATE_LIMIT || '10', 10),
    },
    api: {
      windowMs: 60 * 1000, // 1 minute
      max: parseInt(process.env.API_RATE_LIMIT || '60', 10),
    },
  },

  lockout: {
    maxAttempts: 5,
    durationMs: 15 * 60 * 1000, // 15 minutes
  },

  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:4173').split(','),
  },

  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  },
};
