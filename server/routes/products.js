// ─── server/routes/products.js ────────────────────────────────────────────
// Public products API — no auth required
import { Router } from 'express';
import { query, body, validationResult } from 'express-validator';
import { PRODUCTS, CATEGORIES } from '../data/products.js';
import { requireAuth } from '../middleware/authenticate.js';
import { verifyCsrfToken } from '../middleware/security.js';
import { db } from '../services/db.js';

const router = Router();

// ─── GET /api/products ────────────────────────────────────────────────
// Returns all products, with optional filtering & searching
// Query params: ?category=iphone&q=pro&limit=10&offset=0&sort=price_asc
const listRules = [
  query('category').optional().isIn([...CATEGORIES, 'all']).withMessage(`Category must be one of: ${CATEGORIES.join(', ')}, all`),
  query('q').optional().isString().isLength({ max: 100 }).trim(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
  query('sort').optional().isIn(['price_asc', 'price_desc', 'rating', 'newest', 'name']),
  query('inStock').optional().isBoolean().toBoolean(),
];

router.get('/', listRules, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Invalid query parameters.',
      code: 'VALIDATION_ERROR',
      fields: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  const {
    category,
    q,
    limit = 20,
    offset = 0,
    sort = 'newest',
    inStock,
  } = req.query;

  let results = [...PRODUCTS];

  // Filter by category
  if (category && category !== 'all') {
    results = results.filter(p => p.category === category);
  }

  // Filter by stock
  if (inStock !== undefined) {
    results = results.filter(p => p.inStock === inStock);
  }

  // Full-text search on name, tagline, description
  if (q) {
    const term = q.toLowerCase();
    results = results.filter(p =>
      p.name.toLowerCase().includes(term) ||
      p.tagline.toLowerCase().includes(term) ||
      p.description.toLowerCase().includes(term) ||
      p.highlights?.some(h => h.toLowerCase().includes(term))
    );
  }

  // Sort
  switch (sort) {
    case 'price_asc':  results.sort((a, b) => a.price - b.price); break;
    case 'price_desc': results.sort((a, b) => b.price - a.price); break;
    case 'rating':     results.sort((a, b) => b.rating - a.rating); break;
    case 'name':       results.sort((a, b) => a.name.localeCompare(b.name)); break;
    case 'newest':
    default:           /* keep insertion order = newest first */ break;
  }

  const total = results.length;
  const paginated = results.slice(offset, offset + limit);

  // Cache public product lists for 60 seconds
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');

  return res.status(200).json({
    products: paginated,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  });
});

// ─── GET /api/products/categories ────────────────────────────────────
// Returns all available categories with counts
router.get('/categories', (req, res) => {
  const counts = CATEGORIES.map(cat => ({
    id: cat,
    name: cat.charAt(0).toUpperCase() + cat.slice(1).replace('-', ' & '),
    count: PRODUCTS.filter(p => p.category === cat).length,
  }));
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  return res.status(200).json({ categories: counts });
});

// ─── GET /api/products/featured ───────────────────────────────────────
// Returns featured/hero products (one per category, highest rated)
router.get('/featured', (req, res) => {
  const featured = CATEGORIES.map(cat => {
    const catProducts = PRODUCTS.filter(p => p.category === cat);
    return catProducts.sort((a, b) => b.rating - a.rating)[0];
  }).filter(Boolean);

  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  return res.status(200).json({ products: featured });
});

// ─── GET /api/products/search ─────────────────────────────────────────
// Dedicated search endpoint
router.get('/search', [
  query('q').notEmpty().withMessage('Search query required.').isLength({ max: 100 }).trim(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Search query is required.',
      code: 'VALIDATION_ERROR',
    });
  }

  const term = req.query.q.toLowerCase();
  const results = PRODUCTS.filter(p =>
    p.name.toLowerCase().includes(term) ||
    p.tagline.toLowerCase().includes(term) ||
    p.description.toLowerCase().includes(term) ||
    p.highlights?.some(h => h.toLowerCase().includes(term)) ||
    p.category.toLowerCase().includes(term)
  );

  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
  return res.status(200).json({
    query: req.query.q,
    results,
    total: results.length,
  });
});

// ─── GET /api/products/:id/reviews ──────────────────────────────────────
router.get('/:id/reviews', (req, res) => {
  const product = PRODUCTS.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.', code: 'NOT_FOUND' });

  try {
    const rows = db.prepare(`
      SELECT r.id, r.rating, r.title, r.body, r.created_at,
             u.name as reviewer_name
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      WHERE r.product_id = ?
      ORDER BY r.created_at DESC
    `).all(req.params.id);

    const avgRating = rows.length
      ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 10) / 10
      : product.rating;

    return res.status(200).json({
      productId: req.params.id,
      reviews: rows.map(r => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        reviewerName: r.reviewer_name,
        createdAt: r.created_at,
      })),
      total: rows.length,
      averageRating: avgRating,
    });
  } catch (err) {
    console.error('[products/reviews/get]', err);
    return res.status(500).json({ error: 'Could not fetch reviews.', code: 'INTERNAL_ERROR' });
  }
});

// ─── POST /api/products/:id/reviews ──────────────────────────────────────
// Submit a review (requires auth; one per user per product)
const reviewRules = [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1–5.'),
  body('title').optional().isString().isLength({ max: 120 }).trim(),
  body('body').optional().isString().isLength({ max: 2000 }).trim(),
];

router.post('/:id/reviews', requireAuth, verifyCsrfToken, reviewRules, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Validation failed.', code: 'VALIDATION_ERROR',
      fields: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }

  const product = PRODUCTS.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.', code: 'NOT_FOUND' });

  // Check user has purchased this product
  const hasPurchased = db.prepare(`
    SELECT COUNT(*) as n FROM orders
    WHERE user_id = ? AND items LIKE ?
  `).get(req.user.id, `%${req.params.id}%`).n > 0;

  if (!hasPurchased) {
    return res.status(403).json({
      error: 'You can only review products you have purchased.',
      code: 'PURCHASE_REQUIRED',
    });
  }

  try {
    const { rating, title = null, body: reviewBody = null } = req.body;
    db.prepare(`
      INSERT INTO reviews (product_id, user_id, rating, title, body)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(product_id, user_id) DO UPDATE
      SET rating = excluded.rating, title = excluded.title,
          body = excluded.body, created_at = datetime('now')
    `).run(req.params.id, req.user.id, rating, title, reviewBody);

    console.log(`[reviews] Review submitted for ${req.params.id} by ${req.user.email} (${rating}★)`);
    return res.status(201).json({ message: 'Review submitted.', code: 'REVIEW_SUBMITTED' });
  } catch (err) {
    console.error('[products/reviews/post]', err);
    return res.status(500).json({ error: 'Could not submit review.', code: 'INTERNAL_ERROR' });
  }
});

// ─── GET /api/products/:id ───────────────────────────────────────────────────
// Get a single product by ID
router.get('/:id', (req, res) => {
  const product = PRODUCTS.find(p => p.id === req.params.id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found.', code: 'NOT_FOUND' });
  }

  // Include related products from same category
  const related = PRODUCTS
    .filter(p => p.category === product.category && p.id !== product.id)
    .slice(0, 4);

  return res.status(200).json({ product, related });
});

export default router;
