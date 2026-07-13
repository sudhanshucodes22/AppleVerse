// ─── server/middleware/security.js ───────────────────────────────────
// All security middleware: Helmet, CORS, rate limiting, CSRF
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, randomUUID } from 'crypto';
import config from '../config.js';

// ─── 0. Request ID ─────────────────────────────────────────────────────
/** Attaches a unique X-Request-ID to every request for log correlation */
export function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
}


// ─── 1. Helmet — 15+ security headers ────────────────────────────────
export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "https://cdn.tailwindcss.com", "'unsafe-inline'"],
      styleSrc:       ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc:        ["'self'", "https://fonts.gstatic.com"],
      imgSrc:         ["'self'", "https://lh3.googleusercontent.com", "data:", "blob:"],
      connectSrc:     ["'self'"],
      frameSrc:       ["'none'"],
      frameAncestors: ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      objectSrc:      ["'none'"],
      upgradeInsecureRequests: config.isProduction ? [] : null,
    },
    reportOnly: false,
  },
  hsts: {
    maxAge: 31536000,         // 1 year
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false, // Allow Tailwind CDN
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  dnsPrefetchControl: { allow: true },
  frameguard: { action: 'deny' },
  hidePoweredBy: true,         // Remove X-Powered-By: Express
  ieNoOpen: true,
  noSniff: true,
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  xssFilter: true,
});

// ─── 2. CORS — strict origin whitelist ───────────────────────────────
export const corsMiddleware = cors({
  origin(origin, callback) {
    // Allow requests with no origin (curl, server-to-server)
    if (!origin) return callback(null, true);
    if (config.cors.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: Origin '${origin}' not allowed`));
  },
  credentials: true,             // Allow cookies to be sent
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['X-RateLimit-Remaining', 'Retry-After'],
  maxAge: 600,                   // Preflight cache: 10 minutes
});

// ─── 3. Rate Limiters ─────────────────────────────────────────────────
/** Strict limiter for auth endpoints (login/register) */
export const authLimiter = rateLimit({
  windowMs: config.rateLimit.auth.windowMs,
  max: config.rateLimit.auth.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: {
    error: 'Too many requests from this IP. Please try again in 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: Math.ceil(config.rateLimit.auth.windowMs / 1000),
  },
  handler(req, res, next, options) {
    console.warn(`[rate-limit] Auth rate limit hit from IP: ${req.ip}`);
    res.status(429).json(options.message);
  },
});

/** General limiter for all API routes */
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.api.windowMs,
  max: config.rateLimit.api.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

// ─── 4. CSRF Protection (Double-Submit Cookie Pattern) ────────────────
/**
 * Generates a CSRF token and sets it as a readable cookie.
 * The client must send this token back in the X-CSRF-Token header.
 * Since only same-origin JS can read the cookie, this prevents CSRF.
 */
export function generateCsrfToken(req, res, next) {
  if (!req.cookies['csrf-token']) {
    const token = randomBytes(32).toString('hex');
    res.cookie('csrf-token', token, {
      httpOnly: false,    // Readable by JS (intentional for CSRF pattern)
      secure: config.isProduction,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    });
    req.csrfToken = token;
  } else {
    req.csrfToken = req.cookies['csrf-token'];
  }
  next();
}

export function verifyCsrfToken(req, res, next) {
  // Skip CSRF check for GET/HEAD/OPTIONS (safe methods)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const cookieToken = req.cookies['csrf-token'];
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    console.warn(`[csrf] CSRF validation failed from IP: ${req.ip}`);
    return res.status(403).json({
      error: 'Invalid or missing CSRF token.',
      code: 'CSRF_VALIDATION_FAILED',
    });
  }
  next();
}

// ─── 5. Request Sanitization ──────────────────────────────────────────
/** Remove dangerous characters and limit payload size */
export function sanitizeRequest(req, res, next) {
  // Strip null bytes from all string fields in body
  if (req.body && typeof req.body === 'object') {
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'string') {
        req.body[key] = value.replace(/\0/g, '').trim();
      }
    }
  }
  next();
}

// ─── 6. Security Logging ─────────────────────────────────────────────
export function securityLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level    = res.statusCode >= 400 ? 'WARN' : 'INFO';
    const ts       = new Date().toISOString();
    const reqId    = req.requestId ? `[${req.requestId.slice(0, 8)}]` : '';
    if (req.path.startsWith('/api/')) {
      console.log(`[${ts}] ${reqId} [${level}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms) IP:${req.ip}`);
    }
  });
  next();
}
