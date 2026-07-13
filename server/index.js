// ─── server/index.js ─────────────────────────────────────────────────
// Express application entry point
import express from 'express';
import cookieParser from 'cookie-parser';
import os from 'os';
import config from './config.js';
import {
  helmetMiddleware,
  corsMiddleware,
  apiLimiter,
  generateCsrfToken,
  sanitizeRequest,
  securityLogger,
} from './middleware/security.js';
import authRoutes    from './routes/auth.js';
import userRoutes    from './routes/user.js';
import productRoutes from './routes/products.js';
import cartRoutes    from './routes/cart.js';
import wishlistRoutes from './routes/wishlist.js';
import adminRoutes   from './routes/admin.js';
import { db } from './services/db.js';
import { PRODUCTS, CATEGORIES } from './data/products.js';

const app = express();
const SERVER_START = Date.now();

// ─── Trust proxy (for correct IP in rate limiting behind Nginx/LB) ───
app.set('trust proxy', 1);

// ─── Security Middleware Stack (ORDER MATTERS) ────────────────────────
app.use(helmetMiddleware);          // 1. Security headers first
app.use(corsMiddleware);            // 2. CORS
app.use(apiLimiter);                // 3. Global rate limit
app.use(cookieParser());            // 4. Parse cookies
app.use(express.json({ limit: '10kb' }));          // 5. Parse JSON (10KB max)
app.use(express.urlencoded({ extended: false, limit: '10kb' })); // 6. Parse URL-encoded
app.use(sanitizeRequest);           // 7. Strip null bytes
app.use(generateCsrfToken);         // 8. Generate/read CSRF token
app.use(securityLogger);            // 9. Log security events

// ─── API Routes ───────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/user',     userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart',     cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/admin',    adminRoutes);

// ─── Health Check (enhanced with diagnostics) ─────────────────────────
app.get('/api/health', (req, res) => {
  // DB connectivity check
  let dbStatus = 'ok';
  let productCount = 0;
  try {
    db.prepare('SELECT 1').get();
    productCount = PRODUCTS.length;
  } catch {
    dbStatus = 'error';
  }

  const uptimeSecs  = Math.floor((Date.now() - SERVER_START) / 1000);
  const memMB       = process.memoryUsage();

  res.status(200).json({
    status:      dbStatus === 'ok' ? 'ok' : 'degraded',
    version:     '2.0.0',
    timestamp:   new Date().toISOString(),
    environment: config.nodeEnv,
    uptime: {
      seconds: uptimeSecs,
      human:   `${Math.floor(uptimeSecs / 3600)}h ${Math.floor((uptimeSecs % 3600) / 60)}m ${uptimeSecs % 60}s`,
    },
    database:  { status: dbStatus },
    catalog: {
      products:   productCount,
      categories: CATEGORIES.length,
    },
    memory: {
      heapUsedMB:  Math.round(memMB.heapUsed  / 1024 / 1024),
      heapTotalMB: Math.round(memMB.heapTotal / 1024 / 1024),
      rssMB:       Math.round(memMB.rss       / 1024 / 1024),
    },
  });
});

// ─── 404 Handler ──────────────────────────────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.', code: 'NOT_FOUND' });
});

// ─── Global Error Handler ─────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.message?.includes('CORS')) {
    return res.status(403).json({ error: 'CORS error.', code: 'CORS_ERROR' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.', code: 'PAYLOAD_TOO_LARGE' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON.', code: 'INVALID_JSON' });
  }
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
});

// ─── Start Server ─────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`\n🛡️  AppleVerse API Server`);
  console.log(`   Port:        ${config.port}`);
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   CORS origins: ${config.cors.allowedOrigins.join(', ')}`);
  console.log(`   Products:    ${PRODUCTS.length} across ${CATEGORIES.length} categories`);
  console.log(`   Auth rate limit: ${config.rateLimit.auth.max} req/${config.rateLimit.auth.windowMs / 60000}min`);
  console.log(`\n✅ Server ready at http://localhost:${config.port}\n`);
});

export default app;

