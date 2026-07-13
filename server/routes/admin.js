// ─── server/routes/admin.js ───────────────────────────────────────────
// Admin-only routes. Protected by ADMIN_SECRET header or env var.
// In production this should be replaced with role-based auth.
import { Router } from 'express';
import { db } from '../services/db.js';
import { PRODUCTS, CATEGORIES } from '../data/products.js';

const router = Router();

// ─── Admin Auth Middleware ─────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    // If no ADMIN_SECRET configured, block all admin access
    return res.status(503).json({ error: 'Admin endpoint not configured.', code: 'ADMIN_NOT_CONFIGURED' });
  }
  const provided = req.headers['x-admin-secret'];
  if (!provided || provided !== adminSecret) {
    console.warn(`[admin] Unauthorized admin access attempt from IP: ${req.ip}`);
    return res.status(403).json({ error: 'Unauthorized.', code: 'UNAUTHORIZED' });
  }
  next();
}

// ─── GET /api/admin/stats ─────────────────────────────────────────────
// Store-wide statistics dashboard
router.get('/stats', requireAdmin, (req, res) => {
  try {
    const totalUsers    = db.prepare("SELECT COUNT(*) as n FROM users WHERE deleted_at IS NULL").get().n;
    const totalOrders   = db.prepare("SELECT COUNT(*) as n FROM orders").get().n;
    const totalRevenue  = db.prepare("SELECT COALESCE(SUM(total), 0) as n FROM orders").get().n;
    const activeTokens  = db.prepare("SELECT COUNT(*) as n FROM refresh_tokens WHERE expires_at > datetime('now')").get().n;
    const cartItemCount = db.prepare("SELECT COUNT(*) as n FROM cart").get().n;
    const wishlistCount = db.prepare("SELECT COUNT(*) as n FROM wishlist").get().n;

    // Orders by status
    const ordersByStatus = db.prepare("SELECT status, COUNT(*) as count FROM orders GROUP BY status").all();

    // Top 5 cart products
    const topCartProducts = db.prepare(`
      SELECT product_id, SUM(qty) as total_qty
      FROM cart
      GROUP BY product_id
      ORDER BY total_qty DESC
      LIMIT 5
    `).all().map(row => {
      const product = PRODUCTS.find(p => p.id === row.product_id);
      return { productId: row.product_id, name: product?.name || row.product_id, totalQty: row.total_qty };
    });

    // Top 5 wishlist products
    const topWishlistProducts = db.prepare(`
      SELECT product_id, COUNT(*) as save_count
      FROM wishlist
      GROUP BY product_id
      ORDER BY save_count DESC
      LIMIT 5
    `).all().map(row => {
      const product = PRODUCTS.find(p => p.id === row.product_id);
      return { productId: row.product_id, name: product?.name || row.product_id, saveCount: row.save_count };
    });

    // Category breakdown
    const categoryBreakdown = CATEGORIES.map(cat => ({
      category: cat,
      productCount: PRODUCTS.filter(p => p.category === cat).length,
    }));

    // Recent users (last 5)
    const recentUsers = db.prepare(`
      SELECT id, name, email, created_at FROM users
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 5
    `).all();

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      store: {
        totalProducts:  PRODUCTS.length,
        totalCategories: CATEGORIES.length,
        categoryBreakdown,
      },
      users: {
        total:        totalUsers,
        activeSessions: activeTokens,
        recent:       recentUsers,
      },
      orders: {
        total:    totalOrders,
        revenue:  { amount: totalRevenue, currency: 'INR' },
        byStatus: ordersByStatus,
      },
      engagement: {
        cartItems:    cartItemCount,
        wishlistItems: wishlistCount,
        topCartProducts,
        topWishlistProducts,
      },
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    return res.status(500).json({ error: 'Could not fetch stats.', code: 'INTERNAL_ERROR' });
  }
});

// ─── GET /api/admin/users ─────────────────────────────────────────────
// List all users (paginated)
router.get('/users', requireAdmin, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = parseInt(req.query.offset || '0', 10);
  try {
    const total = db.prepare("SELECT COUNT(*) as n FROM users WHERE deleted_at IS NULL").get().n;
    const users = db.prepare(`
      SELECT id, name, email, created_at, last_login_at, is_verified, failed_login_attempts, locked_until
      FROM users WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    return res.status(200).json({ users, total, limit, offset, hasMore: offset + limit < total });
  } catch (err) {
    console.error('[admin/users]', err);
    return res.status(500).json({ error: 'Could not fetch users.', code: 'INTERNAL_ERROR' });
  }
});

// ─── GET /api/admin/orders ────────────────────────────────────────────
// List all orders (paginated, newest first)
router.get('/orders', requireAdmin, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = parseInt(req.query.offset || '0', 10);
  try {
    const total = db.prepare("SELECT COUNT(*) as n FROM orders").get().n;
    const orders = db.prepare(`
      SELECT o.*, u.name as user_name, u.email as user_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.placed_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset).map(row => ({
      id:        row.id,
      orderRef:  row.order_ref,
      userId:    row.user_id,
      userName:  row.user_name,
      userEmail: row.user_email,
      items:     JSON.parse(row.items),
      total:     row.total,
      currency:  row.currency,
      status:    row.status,
      placedAt:  row.placed_at,
    }));
    return res.status(200).json({ orders, total, limit, offset, hasMore: offset + limit < total });
  } catch (err) {
    console.error('[admin/orders]', err);
    return res.status(500).json({ error: 'Could not fetch orders.', code: 'INTERNAL_ERROR' });
  }
});

export default router;
