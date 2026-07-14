import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/authenticate.js';
import { verifyCsrfToken } from '../middleware/security.js';
import { db } from '../services/db.js';
import { sendOrderInvoiceEmail } from '../services/email.js';
import { PRODUCTS } from '../data/products.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
router.use(requireAuth);

const USD_TO_INR = 83.0;

// Helper: Calculate totals in INR
function calculateCartTotals(cartItems) {
  let subtotal = 0;
  const itemsList = cartItems.map(item => {
    // Map catalog products if we have details
    const product = PRODUCTS.find(p => p.id === item.product_id);
    const unitPrice = product ? product.price : 99.00; // fallback default
    const lineTotal = unitPrice * item.qty;
    subtotal += lineTotal;

    return {
      productId: item.product_id,
      name: product ? product.name : item.product_id,
      image: product ? product.image : '/images/apple_vision_pro.jpg',
      price: unitPrice,
      qty: item.qty,
      color: item.color || 'Standard',
      storage: item.storage || 'Default',
      lineTotal
    };
  });

  const subtotalInr = subtotal * USD_TO_INR;
  const taxInr = subtotalInr * 0.18; // 18% inclusive GST
  const totalInr = subtotalInr; // Inclusive

  return {
    items: itemsList,
    subtotal: subtotalInr - taxInr,
    tax: taxInr,
    total: subtotalInr
  };
}

// ─── POST /api/checkout/create-payment-intent ────────────────────────
// Creates a Stripe-like Payment Intent, saving state locally
router.post('/create-payment-intent', verifyCsrfToken, async (req, res) => {
  try {
    // Get user's active cart items from DB
    const cartItems = db.prepare('SELECT * FROM cart WHERE user_id = ?').all(req.user.id);
    if (!cartItems.length) {
      return res.status(400).json({ error: 'Your cart is empty.', code: 'CART_EMPTY' });
    }

    const totals = calculateCartTotals(cartItems);
    const paymentIntentId = `pi_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const clientSecret = `${paymentIntentId}_secret_${uuidv4().replace(/-/g, '').slice(0, 8)}`;

    // Store the pending payment intent
    db.prepare(`
      INSERT INTO payment_intents (id, user_id, amount, currency, status, items)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(paymentIntentId, req.user.id, totals.total, 'INR', 'pending', JSON.stringify(totals));

    return res.status(200).json({
      clientSecret,
      paymentIntentId,
      amount: totals.total,
      currency: 'INR'
    });
  } catch (err) {
    console.error('[checkout/create-payment-intent]', err);
    return res.status(500).json({ error: 'Failed to create payment intent.', code: 'INTERNAL_ERROR' });
  }
});

// ─── POST /api/checkout/confirm-payment ──────────────────────────────
// Confirms payment succeeded and atomic checkout database operations
router.post('/confirm-payment', verifyCsrfToken, [
  body('paymentIntentId').notEmpty().withMessage('Payment Intent ID is required.'),
  body('cardLast4').isLength({ min: 4, max: 4 }).withMessage('Card last 4 digits required.'),
  body('shippingAddress').notEmpty().withMessage('Shipping address is required.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ error: 'Validation failed.', fields: errors.array() });
  }

  const { paymentIntentId, cardLast4, shippingAddress } = req.body;

  try {
    // 1. Verify payment intent exists and is pending
    const pi = db.prepare('SELECT * FROM payment_intents WHERE id = ? AND user_id = ?').get(paymentIntentId, req.user.id);
    if (!pi) {
      return res.status(404).json({ error: 'Payment intent not found.', code: 'NOT_FOUND' });
    }

    if (pi.status !== 'pending') {
      return res.status(400).json({ error: `Payment intent status is already: ${pi.status}`, code: 'INVALID_STATUS' });
    }

    const totals = JSON.parse(pi.items);
    const orderRef = `AV-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const orderId = uuidv4();
    const placedAt = new Date().toISOString();

    // 2. Perform atomic transactions
    const runCheckoutTx = db.transaction(() => {
      // Update Payment Intent to succeeded
      db.prepare("UPDATE payment_intents SET status = 'succeeded' WHERE id = ?").run(paymentIntentId);

      // Create Order
      db.prepare(`
        INSERT INTO orders (id, user_id, order_ref, items, subtotal, tax, total, currency, status, placed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderId, 
        req.user.id, 
        orderRef, 
        JSON.stringify(totals.items), 
        totals.subtotal, 
        totals.tax, 
        totals.total, 
        'INR', 
        'Confirmed', 
        placedAt
      );

      // Create a notification for the order placement
      db.prepare(`
        INSERT INTO notifications (user_id, title, message)
        VALUES (?, ?, ?)
      `).run(
        req.user.id,
        'Order Placed Successfully',
        `Your order ${orderRef} for ₹${totals.total.toLocaleString('en-IN')} is confirmed and is being processed!`
      );

      // Clear the user's database cart
      db.prepare('DELETE FROM cart WHERE user_id = ?').run(req.user.id);
    });

    runCheckoutTx();

    const newOrder = {
      id: orderId,
      order_ref: orderRef,
      items: JSON.stringify(totals.items),
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      currency: 'INR',
      status: 'Confirmed',
      placed_at: placedAt
    };

    // 3. Dispatch the styled Apple invoice email in the background
    // (don't let email failures block checkout response)
    try {
      await sendOrderInvoiceEmail(req.user, newOrder);
    } catch (mailErr) {
      console.error('[checkout/confirm] Invoice email failed:', mailErr);
    }

    return res.status(200).json({
      message: 'Payment confirmed and order placed successfully.',
      code: 'PAYMENT_SUCCEEDED',
      order: {
        id: orderId,
        orderRef,
        total: totals.total,
        status: 'Confirmed'
      }
    });

  } catch (err) {
    console.error('[checkout/confirm]', err);
    return res.status(500).json({ error: 'Failed to confirm payment.', code: 'INTERNAL_ERROR' });
  }
});

export default router;
