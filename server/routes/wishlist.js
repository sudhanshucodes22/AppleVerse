// ─── server/routes/wishlist.js ────────────────────────────────────────
// Wishlist (saved items) API — requires authentication
import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/authenticate.js';
import { verifyCsrfToken } from '../middleware/security.js';
import { db } from '../services/db.js';
import { PRODUCTS } from '../data/products.js';

const router = Router();

// All wishlist routes require authentication
router.use(requireAuth);

// ─── Helper: enrich a wishlist row with product data ─────────────────
function enrichWishlistRow(row) {
  const product = PRODUCTS.find(p => p.id === row.product_id);
  if (!product) return null;
  return {
    wishlistItemId: row.id,
    productId:      row.product_id,
    addedAt:        row.added_at,
    name:           product.name,
    tagline:        product.tagline,
    image:          product.image,
    price:          product.price,
    currency:       product.currency,
    badge:          product.badge,
    rating:         product.rating,
    category:       product.category,
    inStock:        product.inStock,
  };
}

// ─── GET /api/wishlist ────────────────────────────────────────────────
// Returns the authenticated user's wishlist items
router.get('/', (req, res) => {
  try {
    const rows  = db.prepare(`
      SELECT * FROM wishlist WHERE user_id = ? ORDER BY added_at DESC
    `).all(req.user.id);

    const items = rows.map(enrichWishlistRow).filter(Boolean);
    return res.status(200).json({ items, total: items.length });
  } catch (err) {
    console.error('[wishlist/get]', err);
    return res.status(500).json({ error: 'Could not fetch wishlist.', code: 'INTERNAL_ERROR' });
  }
});

// ─── POST /api/wishlist ───────────────────────────────────────────────
// Add a product to the wishlist (idempotent — safe to call multiple times)
router.post('/', verifyCsrfToken, [
  body('productId').notEmpty().withMessage('Product ID is required.').isString(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Validation failed.', code: 'VALIDATION_ERROR',
      fields: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  const { productId } = req.body;

  // Verify product exists
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found.', code: 'NOT_FOUND' });
  }

  try {
    // INSERT OR IGNORE makes this idempotent
    db.prepare(`
      INSERT OR IGNORE INTO wishlist (user_id, product_id, added_at)
      VALUES (?, ?, datetime('now'))
    `).run(req.user.id, productId);

    const rows  = db.prepare(`
      SELECT * FROM wishlist WHERE user_id = ? ORDER BY added_at DESC
    `).all(req.user.id);
    const items = rows.map(enrichWishlistRow).filter(Boolean);

    console.log(`[wishlist] Added: ${productId} for user ${req.user.email}`);
    return res.status(200).json({ message: 'Added to wishlist.', items, total: items.length });
  } catch (err) {
    console.error('[wishlist/add]', err);
    return res.status(500).json({ error: 'Could not add to wishlist.', code: 'INTERNAL_ERROR' });
  }
});

// ─── GET /api/wishlist/check/:productId ───────────────────────────────────
// Check if a specific product is in the user's wishlist
router.get('/check/:productId', (req, res) => {
  try {
    const row = db.prepare(`
      SELECT id FROM wishlist WHERE user_id = ? AND product_id = ?
    `).get(req.user.id, req.params.productId);
    return res.status(200).json({ inWishlist: !!row, productId: req.params.productId });
  } catch (err) {
    console.error('[wishlist/check]', err);
    return res.status(500).json({ error: 'Could not check wishlist.', code: 'INTERNAL_ERROR' });
  }
});

// ─── DELETE /api/wishlist/:productId ───────────────────────────────────
// Remove a specific product from the wishlist
router.delete('/:productId', verifyCsrfToken, (req, res) => {
  try {
    const result = db.prepare(`
      DELETE FROM wishlist WHERE user_id = ? AND product_id = ?
    `).run(req.user.id, req.params.productId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Item not in wishlist.', code: 'NOT_FOUND' });
    }

    const rows  = db.prepare(`
      SELECT * FROM wishlist WHERE user_id = ? ORDER BY added_at DESC
    `).all(req.user.id);
    const items = rows.map(enrichWishlistRow).filter(Boolean);

    console.log(`[wishlist] Removed: ${req.params.productId} for user ${req.user.email}`);
    return res.status(200).json({ message: 'Removed from wishlist.', items, total: items.length });
  } catch (err) {
    console.error('[wishlist/remove]', err);
    return res.status(500).json({ error: 'Could not remove from wishlist.', code: 'INTERNAL_ERROR' });
  }
});

// ─── DELETE /api/wishlist ─────────────────────────────────────────────
// Clear the entire wishlist
router.delete('/', verifyCsrfToken, (req, res) => {
  try {
    db.prepare('DELETE FROM wishlist WHERE user_id = ?').run(req.user.id);
    return res.status(200).json({ message: 'Wishlist cleared.', items: [], total: 0 });
  } catch (err) {
    console.error('[wishlist/clear]', err);
    return res.status(500).json({ error: 'Could not clear wishlist.', code: 'INTERNAL_ERROR' });
  }
});

export default router;
