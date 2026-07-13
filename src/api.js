/**
 * AppleVerse — Frontend API Client (src/api.js)
 * Products + Cart + Wishlist + Orders API helpers.
 * All cart/wishlist/order mutations require the user to be logged in (JWT via apiFetch).
 */
import { apiFetch } from './auth.js';

const API = '/api';

// ─── Products API (public, no auth needed) ────────────────────────────

/**
 * Fetch a list of products.
 * @param {{ category?: string, q?: string, sort?: string, limit?: number, offset?: number }} opts
 */
export async function getProducts(opts = {}) {
  const params = new URLSearchParams();
  if (opts.category && opts.category !== 'all') params.set('category', opts.category);
  if (opts.q)      params.set('q', opts.q);
  if (opts.sort)   params.set('sort', opts.sort);
  if (opts.limit)  params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  if (opts.inStock !== undefined) params.set('inStock', String(opts.inStock));

  const qs = params.toString();
  const res = await fetch(`${API}/products${qs ? '?' + qs : ''}`, { credentials: 'include' });
  return res.json();
}

/**
 * Get featured products (one per category, highest rated).
 */
export async function getFeaturedProducts() {
  const res = await fetch(`${API}/products/featured`, { credentials: 'include' });
  return res.json();
}

/**
 * Get all product categories with counts.
 */
export async function getCategories() {
  const res = await fetch(`${API}/products/categories`, { credentials: 'include' });
  return res.json();
}

/**
 * Search products by text.
 * @param {string} query
 */
export async function searchProducts(query) {
  const res = await fetch(`${API}/products/search?q=${encodeURIComponent(query)}`, { credentials: 'include' });
  return res.json();
}

/**
 * Get a single product by ID, including related products.
 * @param {string} productId
 */
export async function getProduct(productId) {
  const res = await fetch(`${API}/products/${encodeURIComponent(productId)}`, { credentials: 'include' });
  return res.json();
}

// ─── Cart API (requires JWT auth) ─────────────────────────────────────

/**
 * Get the current user's cart.
 * Returns { items, subtotal, tax, total, currency, itemCount }
 */
export async function getCart() {
  const res = await apiFetch('/cart');
  if (!res) return null;
  return res.json();
}

/**
 * Add a product to the cart (upserts if same product+options exist).
 * @param {{ productId: string, qty: number, color?: string, storage?: string }} item
 */
export async function addToCart(item) {
  const res = await apiFetch('/cart', {
    method: 'POST',
    body: JSON.stringify(item),
  });
  if (!res) return null;
  return res.json();
}

/**
 * Update quantity of a cart item. Set qty=0 to remove.
 * @param {number} cartItemId
 * @param {number} qty
 */
export async function updateCartItem(cartItemId, qty) {
  const res = await apiFetch(`/cart/${cartItemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ qty }),
  });
  if (!res) return null;
  return res.json();
}

/**
 * Remove a specific item from the cart.
 * @param {number} cartItemId
 */
export async function removeFromCart(cartItemId) {
  const res = await apiFetch(`/cart/${cartItemId}`, { method: 'DELETE' });
  if (!res) return null;
  return res.json();
}

/**
 * Clear the entire cart.
 */
export async function clearCart() {
  const res = await apiFetch('/cart', { method: 'DELETE' });
  if (!res) return null;
  return res.json();
}

/**
 * Sync a guest cart (from localStorage) into the server cart on login.
 * Call this right after a successful login if localStorage has cart items.
 * @param {Array<{ productId: string, qty: number, color?: string, storage?: string }>} items
 */
export async function syncCart(items) {
  const res = await apiFetch('/cart/sync', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
  if (!res) return null;
  return res.json();
}

/**
 * Checkout — converts the current cart into a confirmed order.
 * Returns { message, code, order: { id, orderRef, items, subtotal, tax, total, currency, status, placedAt } }
 */
export async function checkout() {
  const res = await apiFetch('/cart/checkout', { method: 'POST' });
  if (!res) return null;
  return res.json();
}

// ─── Local (guest) Cart — localStorage ────────────────────────────────
// For users who haven't logged in yet. Synced to server on login.

const LOCAL_CART_KEY = 'av_guest_cart';

export function getLocalCart() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_CART_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveLocalCart(items) {
  localStorage.setItem(LOCAL_CART_KEY, JSON.stringify(items));
}

export function clearLocalCart() {
  localStorage.removeItem(LOCAL_CART_KEY);
}

/**
 * Add an item to the local (guest) cart.
 * @param {{ productId: string, qty: number, color?: string|null, storage?: string|null }} item
 */
export function addToLocalCart(item) {
  const items = getLocalCart();
  const idx = items.findIndex(
    i => i.productId === item.productId && i.color === item.color && i.storage === item.storage
  );
  if (idx >= 0) {
    items[idx].qty = Math.min(items[idx].qty + item.qty, 10);
  } else {
    items.push({ ...item });
  }
  saveLocalCart(items);
  return items;
}

// ─── Wishlist API (requires JWT auth) ─────────────────────────────────

/**
 * Get the current user's wishlist.
 * Returns { items, total }
 */
export async function getWishlist() {
  const res = await apiFetch('/wishlist');
  if (!res) return null;
  return res.json();
}

/**
 * Add a product to the wishlist (idempotent).
 * @param {string} productId
 */
export async function addToWishlist(productId) {
  const res = await apiFetch('/wishlist', {
    method: 'POST',
    body: JSON.stringify({ productId }),
  });
  if (!res) return null;
  return res.json();
}

/**
 * Remove a product from the wishlist.
 * @param {string} productId
 */
export async function removeFromWishlist(productId) {
  const res = await apiFetch(`/wishlist/${encodeURIComponent(productId)}`, { method: 'DELETE' });
  if (!res) return null;
  return res.json();
}

/**
 * Clear the entire wishlist.
 */
export async function clearWishlist() {
  const res = await apiFetch('/wishlist', { method: 'DELETE' });
  if (!res) return null;
  return res.json();
}

/**
 * Check if a specific product is in the current user's wishlist.
 * Returns { inWishlist: boolean }
 * @param {string} productId
 */
export async function checkWishlist(productId) {
  const res = await apiFetch(`/wishlist/check/${encodeURIComponent(productId)}`);
  if (!res) return { inWishlist: false };
  return res.json();
}

// ─── Orders API (requires JWT auth) ───────────────────────────────────

/**
 * Get the current user's order history.
 * Returns { orders: [] }
 */
export async function getOrders() {
  const res = await apiFetch('/user/orders');
  if (!res) return null;
  return res.json();
}

/**
 * Create/save an order manually.
 * @param {{ orderRef: string, items: Array, total: number, currency?: string, status?: string }} data
 */
export async function createOrder(data) {
  const res = await apiFetch('/user/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res) return null;
  return res.json();
}

// ─── Price Formatting ─────────────────────────────────────────────────

/**
 * Format a price number as Indian Rupees.
 * @param {number} amount
 */
export function formatPrice(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

