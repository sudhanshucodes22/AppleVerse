import { Router } from 'express';
import { body, query, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import { requireAuth } from '../middleware/authenticate.js';
import { verifyCsrfToken } from '../middleware/security.js';
import { UserStore } from '../services/userStore.js';
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

export default router;
