import { Router } from 'express';
import { body, query, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import { requireAuth } from '../middleware/authenticate.js';
import { verifyCsrfToken } from '../middleware/security.js';
import { UserStore } from '../services/userStore.js';
import { db } from '../services/db.js';
import config from '../config.js';

const router = Router();

// All routes in this file require authentication
router.use(requireAuth);

// ─── GET /api/user/profile ────────────────────────────────────────────
router.get('/profile', (req, res) => {
  const user = UserStore.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.', code: 'NOT_FOUND' });
  return res.status(200).json({ user: UserStore.toPublic(user) });
});

// ─── PATCH /api/user/profile ──────────────────────────────────────────
const updateProfileRules = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 60 }).withMessage('Name must be 2–60 characters.')
    .matches(/^[a-zA-Z\s'-]+$/).withMessage('Name contains invalid characters.'),
];

router.patch('/profile', verifyCsrfToken, updateProfileRules, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Validation failed.', code: 'VALIDATION_ERROR',
      fields: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  const { name } = req.body;
  const updates = {};
  if (name) updates.name = name;

  const updated = UserStore.update(req.user.id, updates);
  if (!updated) return res.status(404).json({ error: 'User not found.', code: 'NOT_FOUND' });

  console.log(`[user] Profile updated: ${req.user.email}`);
  return res.status(200).json({ message: 'Profile updated.', user: UserStore.toPublic(updated) });
});

// ─── POST /api/user/change-password ──────────────────────────────────
const changePasswordRules = [
  body('currentPassword').notEmpty().withMessage('Current password required.'),
  body('newPassword')
    .isLength({ min: 8, max: 128 }).withMessage('Password must be 8–128 characters.')
    .matches(/[A-Z]/).withMessage('Needs uppercase letter.')
    .matches(/[a-z]/).withMessage('Needs lowercase letter.')
    .matches(/[0-9]/).withMessage('Needs a number.')
    .matches(/[^A-Za-z0-9]/).withMessage('Needs a special character.')
    .custom((value, { req }) => {
      if (value === req.body.currentPassword) throw new Error('New password must differ from current password.');
      return true;
    }),
];

router.post('/change-password', verifyCsrfToken, changePasswordRules, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Validation failed.', code: 'VALIDATION_ERROR',
      fields: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  try {
    const { currentPassword, newPassword } = req.body;
    const user = UserStore.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.', code: 'NOT_FOUND' });

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect.', code: 'INVALID_CREDENTIALS' });
    }

    const newHash = await bcrypt.hash(newPassword, config.bcrypt.saltRounds);
    UserStore.update(user.id, { passwordHash: newHash });

    console.log(`[user] Password changed: ${req.user.email}`);
    return res.status(200).json({ message: 'Password changed successfully.', code: 'PASSWORD_CHANGED' });
  } catch (err) {
    console.error('[user/change-password]', err);
    return res.status(500).json({ error: 'Password change failed.', code: 'INTERNAL_ERROR' });
  }
});

// ─── GET /api/user/orders ──────────────────────────────────────────
router.get('/orders', [
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt().withMessage('Limit must be 1–50.'),
  query('offset').optional().isInt({ min: 0 }).toInt().withMessage('Offset must be ≥ 0.'),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ error: 'Validation failed.', code: 'VALIDATION_ERROR',
      fields: errors.array().map(e => ({ field: e.path, message: e.msg })) });
  }
  const limit  = req.query.limit  ?? 20;
  const offset = req.query.offset ?? 0;
  const result = UserStore.getOrders(req.user.id, limit, offset);
  return res.status(200).json(result);
});

// ─── POST /api/user/orders ────────────────────────────────────────────
const createOrderRules = [
  body('orderRef').notEmpty().withMessage('Order reference required.'),
  body('items').isArray({ min: 1 }).withMessage('Items array is required.'),
  body('items.*.name').notEmpty().withMessage('Item name required.'),
  body('items.*.price').isNumeric().withMessage('Item price must be a number.'),
  body('items.*.qty').isInt({ min: 1 }).withMessage('Item quantity must be at least 1.'),
  body('subtotal').optional().isNumeric(),
  body('tax').optional().isNumeric(),
  body('total').isNumeric().withMessage('Total must be a number.'),
  body('currency').optional().isString(),
  body('status').optional().isString(),
];

router.post('/orders', verifyCsrfToken, createOrderRules, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Validation failed.', code: 'VALIDATION_ERROR',
      fields: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  const { orderRef, items, subtotal = 0, tax = 0, total, currency = 'INR', status = 'Confirmed' } = req.body;
  const order = UserStore.addOrder(req.user.id, { orderRef, items, subtotal, tax, total, currency, status });
  if (!order) {
    return res.status(404).json({ error: 'User not found.', code: 'NOT_FOUND' });
  }

  console.log(`[user] Order placed: ${orderRef} by ${req.user.email} (total: ${currency} ${total})`);
  return res.status(201).json({ message: 'Order saved.', order });
});

// ─── DELETE /api/user/account ─────────────────────────────────────────
router.delete('/account', verifyCsrfToken, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required to delete account.', code: 'PASSWORD_REQUIRED' });

  const user = UserStore.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.', code: 'NOT_FOUND' });

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) return res.status(401).json({ error: 'Incorrect password.', code: 'INVALID_CREDENTIALS' });

  // Mark as deleted rather than removing (soft delete)
  UserStore.update(user.id, { deletedAt: new Date().toISOString(), email: `deleted_${user.id}@deleted.invalid` });

  console.log(`[user] Account deleted: ${req.user.id}`);
  res.clearCookie('__refresh_token', { path: '/api/auth' });
  return res.status(200).json({ message: 'Account deleted.', code: 'ACCOUNT_DELETED' });
});

// ─── Apple ID Dashboard Demo Seeder ──────────────────────────────────
function ensureDemoData(userId) {
  try {
    // Check if applecare empty for user
    const applecareCount = db.prepare('SELECT COUNT(*) as n FROM applecare WHERE user_id = ?').get(userId).n;
    if (applecareCount === 0) {
      db.prepare(`
        INSERT INTO applecare (user_id, device_name, serial_number, expires_at, status)
        VALUES (?, 'iPhone 16 Pro', 'C7GG29X90Y1F', '2027-09-20', 'Active')
      `).run(userId);
      db.prepare(`
        INSERT INTO applecare (user_id, device_name, serial_number, expires_at, status)
        VALUES (?, 'MacBook Air M4', 'M4F982X22Y9A', '2028-06-15', 'Active')
      `).run(userId);
      db.prepare(`
        INSERT INTO applecare (user_id, device_name, serial_number, expires_at, status)
        VALUES (?, 'iPad Pro M4', 'P5K883X11Y2B', '2027-11-05', 'Active')
      `).run(userId);
    }

    // Check if trade_ins empty for user
    const tradeCount = db.prepare('SELECT COUNT(*) as n FROM trade_ins WHERE user_id = ?').get(userId).n;
    if (tradeCount === 0) {
      db.prepare(`
        INSERT INTO trade_ins (user_id, device, estimated_value, status, date)
        VALUES (?, 'iPhone 14 Pro', 32500, 'Inspection Complete', datetime('now', '-2 days'))
      `).run(userId);
      db.prepare(`
        INSERT INTO trade_ins (user_id, device, estimated_value, status, date)
        VALUES (?, 'iPad Air M1', 18000, 'Device Received', datetime('now', '-4 days'))
      `).run(userId);
    }

    // Check if notifications empty for user
    const notifCount = db.prepare('SELECT COUNT(*) as n FROM notifications WHERE user_id = ?').get(userId).n;
    if (notifCount === 0) {
      db.prepare(`
        INSERT INTO notifications (user_id, title, message, is_read, created_at)
        VALUES (?, 'Welcome to AppleVerse', 'Explore our latest Mac, iPhone, iPad, and Watch lineups with custom tailored premium aesthetics.', 0, datetime('now', '-5 days'))
      `).run(userId);
      db.prepare(`
        INSERT INTO notifications (user_id, title, message, is_read, created_at)
        VALUES (?, 'Trade-In Status Updated', 'Your iPhone 14 Pro trade-in device inspection is complete. Eligible for ₹32,500 credit.', 0, datetime('now', '-1 day'))
      `).run(userId);
      db.prepare(`
        INSERT INTO notifications (user_id, title, message, is_read, created_at)
        VALUES (?, 'AppleCare+ Active', 'Your MacBook Air M4 is now fully protected under AppleCare+.', 1, datetime('now', '-3 days'))
      `).run(userId);
    }
  } catch (err) {
    console.error('[db/seed-demo-data] Failed (non-fatal):', err.message);
  }
}

// ─── GET /api/user/dashboard-stats ──────────────────────────────────
router.get('/dashboard-stats', (req, res) => {
  ensureDemoData(req.user.id);
  try {
    const totalOrders = db.prepare('SELECT COUNT(*) as n FROM orders WHERE user_id = ?').get(req.user.id).n;
    const wishlistCount = db.prepare('SELECT COUNT(*) as n FROM wishlist WHERE user_id = ?').get(req.user.id).n;
    const appleCareCount = db.prepare("SELECT COUNT(*) as n FROM applecare WHERE user_id = ? AND status = 'Active'").get(req.user.id).n;
    const totalSpentRow = db.prepare('SELECT SUM(total) as s FROM orders WHERE user_id = ?').get(req.user.id);
    const totalSpent = totalSpentRow ? (totalSpentRow.s || 0) : 0;
    const rewardPoints = Math.round(totalSpent / 10) + 1250;

    return res.status(200).json({
      totalOrders,
      wishlistCount,
      appleCareCount,
      rewardPoints
    });
  } catch (err) {
    console.error('[user/dashboard-stats]', err);
    return res.status(500).json({ error: 'Could not fetch dashboard stats.', code: 'INTERNAL_ERROR' });
  }
});

// ─── Addresses Routes ─────────────────────────────────────────────────
router.get('/addresses', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(req.user.id);
    return res.status(200).json({ addresses: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Could not fetch addresses.', code: 'INTERNAL_ERROR' });
  }
});

router.post('/addresses', [
  body('fullName').notEmpty().trim(),
  body('phone').notEmpty().trim(),
  body('street').notEmpty().trim(),
  body('city').notEmpty().trim(),
  body('state').notEmpty().trim(),
  body('zip').notEmpty().trim(),
  body('country').optional().trim(),
  body('isDefault').optional().isBoolean()
], verifyCsrfToken, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ error: 'Validation failed.', code: 'VALIDATION_ERROR' });
  }
  const { fullName, phone, street, city, state, zip, country = 'India', isDefault = false } = req.body;
  try {
    if (isDefault) {
      db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    }
    const result = db.prepare(`
      INSERT INTO addresses (user_id, full_name, phone, street, city, state, zip, country, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, fullName, phone, street, city, state, zip, country, isDefault ? 1 : 0);
    return res.status(201).json({ id: result.lastInsertRowid, message: 'Address added.' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not add address.', code: 'INTERNAL_ERROR' });
  }
});

router.delete('/addresses/:id', verifyCsrfToken, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Address not found.', code: 'NOT_FOUND' });
    return res.status(200).json({ message: 'Address deleted.' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete address.', code: 'INTERNAL_ERROR' });
  }
});

// ─── Payment Methods Routes ──────────────────────────────────────────
router.get('/payment-methods', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(req.user.id);
    return res.status(200).json({ paymentMethods: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Could not fetch payment methods.', code: 'INTERNAL_ERROR' });
  }
});

router.post('/payment-methods', [
  body('brand').notEmpty().trim(),
  body('cardholder').notEmpty().trim(),
  body('last4').isLength({ min: 4, max: 4 }).trim(),
  body('expMonth').isInt({ min: 1, max: 12 }),
  body('expYear').isInt({ min: 2024 }),
  body('isDefault').optional().isBoolean()
], verifyCsrfToken, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ error: 'Validation failed.', code: 'VALIDATION_ERROR' });
  }
  const { brand, cardholder, last4, expMonth, expYear, isDefault = false } = req.body;
  try {
    if (isDefault) {
      db.prepare('UPDATE payment_methods SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    }
    const result = db.prepare(`
      INSERT INTO payment_methods (user_id, brand, cardholder, last4, exp_month, exp_year, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, brand, cardholder, last4, expMonth, expYear, isDefault ? 1 : 0);
    return res.status(201).json({ id: result.lastInsertRowid, message: 'Card saved.' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not save card.', code: 'INTERNAL_ERROR' });
  }
});

router.delete('/payment-methods/:id', verifyCsrfToken, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM payment_methods WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Card not found.', code: 'NOT_FOUND' });
    return res.status(200).json({ message: 'Card deleted.' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not delete card.', code: 'INTERNAL_ERROR' });
  }
});

// ─── Trade-In Routes ──────────────────────────────────────────────────
router.get('/trade-ins', (req, res) => {
  ensureDemoData(req.user.id);
  try {
    const rows = db.prepare('SELECT * FROM trade_ins WHERE user_id = ? ORDER BY date DESC').all(req.user.id);
    return res.status(200).json({ tradeIns: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Could not fetch trade-ins.', code: 'INTERNAL_ERROR' });
  }
});

router.post('/trade-ins', [
  body('device').notEmpty().trim(),
  body('estimatedValue').isNumeric()
], verifyCsrfToken, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ error: 'Validation failed.', code: 'VALIDATION_ERROR' });
  }
  const { device, estimatedValue } = req.body;
  try {
    const result = db.prepare(`
      INSERT INTO trade_ins (user_id, device, estimated_value, status, date)
      VALUES (?, ?, ?, 'Estimated', datetime('now'))
    `).run(req.user.id, device, estimatedValue);
    return res.status(201).json({ id: result.lastInsertRowid, message: 'Trade-in request created.' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not submit trade-in.', code: 'INTERNAL_ERROR' });
  }
});

// ─── AppleCare Routes ─────────────────────────────────────────────────
router.get('/applecare', (req, res) => {
  ensureDemoData(req.user.id);
  try {
    const rows = db.prepare('SELECT * FROM applecare WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
    return res.status(200).json({ applecare: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Could not fetch AppleCare.', code: 'INTERNAL_ERROR' });
  }
});

router.post('/applecare', [
  body('deviceName').notEmpty().trim(),
  body('serialNumber').notEmpty().trim()
], verifyCsrfToken, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ error: 'Validation failed.', code: 'VALIDATION_ERROR' });
  }
  const { deviceName, serialNumber } = req.body;
  try {
    const expiresAt = new Date(Date.now() + 365 * 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const result = db.prepare(`
      INSERT INTO applecare (user_id, device_name, serial_number, expires_at, status)
      VALUES (?, ?, ?, ?, 'Active')
    `).run(req.user.id, deviceName, serialNumber.toUpperCase(), expiresAt);
    return res.status(201).json({ id: result.lastInsertRowid, message: 'AppleCare+ registered.' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Serial number already registered.', code: 'DUPLICATE_SERIAL' });
    }
    return res.status(500).json({ error: 'Registration failed.', code: 'INTERNAL_ERROR' });
  }
});

// ─── Notifications Routes ─────────────────────────────────────────────
router.get('/notifications', (req, res) => {
  ensureDemoData(req.user.id);
  try {
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    return res.status(200).json({ notifications: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Could not fetch notifications.', code: 'INTERNAL_ERROR' });
  }
});

router.post('/notifications/read', verifyCsrfToken, (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    return res.status(200).json({ message: 'All notifications marked as read.' });
  } catch (err) {
    return res.status(500).json({ error: 'Could not update notifications.', code: 'INTERNAL_ERROR' });
  }
});

// ─── Reviews Routes ───────────────────────────────────────────────────
router.get('/reviews', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT r.id, r.product_id, r.rating, r.title, r.body, r.created_at
      FROM reviews r
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `).all(req.user.id);
    return res.status(200).json({ reviews: rows });
  } catch (err) {
    console.error('[user/reviews]', err);
    return res.status(500).json({ error: 'Could not fetch user reviews.', code: 'INTERNAL_ERROR' });
  }
});

export default router;
