// ─── server/routes/cart.js ────────────────────────────────────────────
// Cart API — persists cart in DB for logged-in users
// Anonymous users manage cart client-side (localStorage), and sync on login
import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { optionalAuth } from '../middleware/authenticate.js';
import { requireAuth } from '../middleware/authenticate.js';
import { verifyCsrfToken } from '../middleware/security.js';
import { db } from '../services/db.js';
import { PRODUCTS } from '../data/products.js';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────
function getCartItems(userId) {
  return db.prepare(`
    SELECT c.id, c.product_id, c.qty, c.color, c.storage, c.added_at
    FROM cart c
    WHERE c.user_id = ?
    ORDER BY c.added_at ASC
  `).all(userId);
}

function enrichCartItems(rows) {
  return rows.map(row => {
    const product = PRODUCTS.find(p => p.id === row.product_id);
    if (!product) return null;
    return {
      cartItemId: row.id,
      productId: row.product_id,
      name: product.name,
      image: product.image,
      category: product.category,
      price: product.price,
      currency: product.currency,
      color: row.color || product.colors?.[0] || null,
      storage: row.storage || product.storage?.[0] || null,
      qty: row.qty,
      lineTotal: product.price * row.qty,
      addedAt: row.added_at,
    };
  }).filter(Boolean);
}

function calcTotals(items) {
  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const tax = Math.round(subtotal * 0.18); // 18% GST
  return { subtotal, tax, total: subtotal + tax, currency: 'INR', itemCount: items.reduce((s, i) => s + i.qty, 0) };
}

// ─── GET /api/cart ────────────────────────────────────────────────────
// Get current user's cart (requires auth)
router.get('/', requireAuth, (req, res) => {
  try {
    const rows  = getCartItems(req.user.id);
    const items = enrichCartItems(rows);
    const totals = calcTotals(items);
    return res.status(200).json({ items, ...totals });
  } catch (err) {
    console.error('[cart/get]', err);
    return res.status(500).json({ error: 'Could not fetch cart.', code: 'INTERNAL_ERROR' });
  }
});

// ─── POST /api/cart ────────────────────────────────────────────────────
// Add or update an item in the cart
const addItemRules = [
  body('productId').notEmpty().withMessage('Product ID required.'),
  body('qty').isInt({ min: 1, max: 10 }).withMessage('Quantity must be 1–10.'),
  body('color').optional().isString().isLength({ max: 60 }),
  body('storage').optional().isString().isLength({ max: 20 }),
];

router.post('/', requireAuth, verifyCsrfToken, addItemRules, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Validation failed.', code: 'VALIDATION_ERROR',
      fields: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  const { productId, qty, color = null, storage = null } = req.body;

  // Verify product exists
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found.', code: 'NOT_FOUND' });
  }

  try {
    // Upsert: if same product+color+storage exists, update qty; else insert
    const existing = db.prepare(`
      SELECT id, qty FROM cart
      WHERE user_id = ? AND product_id = ? AND (color IS ? OR color = ?) AND (storage IS ? OR storage = ?)
    `).get(req.user.id, productId, color, color, storage, storage);

    if (existing) {
      const newQty = Math.min(existing.qty + qty, 10);
      db.prepare('UPDATE cart SET qty = ?, added_at = datetime(\'now\') WHERE id = ?').run(newQty, existing.id);
    } else {
      db.prepare(`
        INSERT INTO cart (user_id, product_id, qty, color, storage, added_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(req.user.id, productId, qty, color, storage);
    }

    const rows  = getCartItems(req.user.id);
    const items = enrichCartItems(rows);
    const totals = calcTotals(items);
    return res.status(200).json({ message: 'Item added to cart.', items, ...totals });
  } catch (err) {
    console.error('[cart/add]', err);
    return res.status(500).json({ error: 'Could not add item.', code: 'INTERNAL_ERROR' });
  }
});

// ─── PATCH /api/cart/:cartItemId ──────────────────────────────────────
// Update quantity of a specific cart item
router.patch('/:id', requireAuth, verifyCsrfToken, [
  body('qty').isInt({ min: 0, max: 10 }).withMessage('Quantity must be 0–10 (0 = remove).'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Validation failed.', code: 'VALIDATION_ERROR',
      fields: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  const { qty } = req.body;
  try {
    const item = db.prepare('SELECT id FROM cart WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!item) return res.status(404).json({ error: 'Cart item not found.', code: 'NOT_FOUND' });

    if (qty === 0) {
      db.prepare('DELETE FROM cart WHERE id = ?').run(req.params.id);
    } else {
      db.prepare('UPDATE cart SET qty = ? WHERE id = ?').run(qty, req.params.id);
    }

    const rows  = getCartItems(req.user.id);
    const items = enrichCartItems(rows);
    const totals = calcTotals(items);
    return res.status(200).json({ message: qty === 0 ? 'Item removed.' : 'Cart updated.', items, ...totals });
  } catch (err) {
    console.error('[cart/update]', err);
    return res.status(500).json({ error: 'Could not update cart.', code: 'INTERNAL_ERROR' });
  }
});

// ─── DELETE /api/cart/:cartItemId ─────────────────────────────────────
// Remove a specific item from cart
router.delete('/:id', requireAuth, verifyCsrfToken, (req, res) => {
  try {
    const item = db.prepare('SELECT id FROM cart WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!item) return res.status(404).json({ error: 'Cart item not found.', code: 'NOT_FOUND' });

    db.prepare('DELETE FROM cart WHERE id = ?').run(req.params.id);

    const rows  = getCartItems(req.user.id);
    const items = enrichCartItems(rows);
    const totals = calcTotals(items);
    return res.status(200).json({ message: 'Item removed from cart.', items, ...totals });
  } catch (err) {
    console.error('[cart/delete]', err);
    return res.status(500).json({ error: 'Could not remove item.', code: 'INTERNAL_ERROR' });
  }
});

// ─── DELETE /api/cart ─────────────────────────────────────────────────
// Clear the entire cart
router.delete('/', requireAuth, verifyCsrfToken, (req, res) => {
  try {
    db.prepare('DELETE FROM cart WHERE user_id = ?').run(req.user.id);
    return res.status(200).json({ message: 'Cart cleared.', items: [], subtotal: 0, tax: 0, total: 0, itemCount: 0 });
  } catch (err) {
    console.error('[cart/clear]', err);
    return res.status(500).json({ error: 'Could not clear cart.', code: 'INTERNAL_ERROR' });
  }
});

// ─── POST /api/cart/sync ──────────────────────────────────────────────
// Merge client-side cart (from localStorage) into server cart on login
router.post('/sync', requireAuth, verifyCsrfToken, [
  body('items').isArray().withMessage('Items must be an array.'),
  body('items.*.productId').notEmpty(),
  body('items.*.qty').isInt({ min: 1, max: 10 }),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ error: 'Validation failed.', code: 'VALIDATION_ERROR' });
  }

  const { items = [] } = req.body;
  try {
    const insertOrUpdate = db.prepare(`
      INSERT INTO cart (user_id, product_id, qty, color, storage, added_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, product_id, color, storage) DO UPDATE
      SET qty = MIN(qty + excluded.qty, 10), added_at = datetime('now')
    `);

    const syncMany = db.transaction((clientItems) => {
      for (const item of clientItems) {
        const product = PRODUCTS.find(p => p.id === item.productId);
        if (!product) continue;
        insertOrUpdate.run(
          req.user.id,
          item.productId,
          item.qty,
          item.color || null,
          item.storage || null
        );
      }
    });

    syncMany(items);

    const rows   = getCartItems(req.user.id);
    const merged = enrichCartItems(rows);
    const totals = calcTotals(merged);
    return res.status(200).json({ message: 'Cart synced.', items: merged, ...totals });
  } catch (err) {
    console.error('[cart/sync]', err);
    return res.status(500).json({ error: 'Cart sync failed.', code: 'INTERNAL_ERROR' });
  }
});

// ─── POST /api/cart/checkout ──────────────────────────────────────────
// Converts the current cart into a confirmed order, then clears the cart.
// Returns the saved order object.
router.post('/checkout', requireAuth, verifyCsrfToken, (req, res) => {
  try {
    const rows  = getCartItems(req.user.id);
    if (!rows.length) {
      return res.status(400).json({ error: 'Your cart is empty.', code: 'CART_EMPTY' });
    }

    const items  = enrichCartItems(rows);
    if (!items.length) {
      return res.status(400).json({ error: 'Cart contains invalid products.', code: 'INVALID_CART' });
    }

    const totals   = calcTotals(items);
    const orderRef = `AV-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    // Build order items payload
    const orderItems = items.map(i => ({
      productId: i.productId,
      name:      i.name,
      image:     i.image,
      price:     i.price,
      color:     i.color,
      storage:   i.storage,
      qty:       i.qty,
      lineTotal: i.lineTotal,
    }));

    // Atomic transaction: insert order + clear cart
    const orderId  = uuidv4();
    const placedAt = new Date().toISOString();

    const checkout = db.transaction(() => {
      db.prepare(`
        INSERT INTO orders (id, user_id, order_ref, items, total, currency, status, placed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orderId, req.user.id, orderRef, JSON.stringify(orderItems), totals.total, 'INR', 'Confirmed', placedAt);

      // Clear cart after order is recorded
      db.prepare('DELETE FROM cart WHERE user_id = ?').run(req.user.id);
    });

    checkout();

    console.log(`[cart/checkout] Order ${orderRef} placed by ${req.user.email} — ₹${totals.total}`);

    return res.status(201).json({
      message:  'Order placed successfully.',
      code:     'ORDER_CONFIRMED',
      order: {
        id:       orderId,
        orderRef,
        items:    orderItems,
        subtotal: totals.subtotal,
        tax:      totals.tax,
        total:    totals.total,
        currency: 'INR',
        status:   'Confirmed',
        placedAt,
      },
    });
  } catch (err) {
    console.error('[cart/checkout]', err);
    return res.status(500).json({ error: 'Checkout failed. Please try again.', code: 'INTERNAL_ERROR' });
  }
});

export default router;

