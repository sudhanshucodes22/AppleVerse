# AppleVerse API Reference — v2.0.0

**Base URL**: `http://localhost:3001` (development)

## Auth Model
- **Access Token**: JWT (15m) — `Authorization: Bearer <token>` header
- **Refresh Token**: JWT (7d) — `__refresh_token` HttpOnly cookie  
- **CSRF**: Double-submit cookie — read `csrf-token` cookie, send in `X-CSRF-Token` header

## Rate Limits
- Auth endpoints: 10 req / 15 min per IP
- All other API: 60 req / 1 min per IP

## Route Groups

### GET /api/health (public)
Returns: status, uptime, DB status, catalog size, memory

### /api/auth
- POST /register — Create account (CSRF + rate-limited)
- POST /login    — Login (CSRF + rate-limited)
- POST /refresh  — Silent token refresh (uses cookie)
- POST /logout   — Invalidate tokens (auth + CSRF)
- GET  /me       — Current user (auth)
- GET  /csrf     — Get CSRF token

### /api/products (public)
- GET /              — List products (?category, ?q, ?sort, ?limit, ?offset, ?inStock)
- GET /categories    — All categories with counts
- GET /featured      — One featured per category
- GET /search?q=...  — Full-text search
- GET /:id           — Single product + related

### /api/cart (auth + CSRF on mutations)
- GET    /           — Get cart with totals
- POST   /           — Add/upsert item {productId, qty, color?, storage?}
- PATCH  /:id        — Update qty (0 = remove)
- DELETE /:id        — Remove item
- DELETE /           — Clear cart
- POST   /sync       — Merge guest cart on login
- POST   /checkout   — Place order, clear cart → returns order

### /api/wishlist (auth + CSRF on mutations)  ★ NEW
- GET    /           — Get wishlist
- POST   /           — Add product {productId}
- DELETE /:productId — Remove from wishlist
- DELETE /           — Clear wishlist
- GET    /check/:id  — Check if product in wishlist

### /api/user (auth + CSRF on mutations)
- GET    /profile           — Get profile
- PATCH  /profile           — Update name
- POST   /change-password   — Change password
- GET    /orders            — Order history
- POST   /orders            — Save order manually
- DELETE /account           — Soft-delete account

### /api/admin (X-Admin-Secret header)  ★ NEW
- GET /stats            — Full store analytics
- GET /users?limit&offset — Paginated user list
- GET /orders?limit&offset — Paginated orders with buyer info

## Common Error Codes
400 VALIDATION_ERROR, 401 UNAUTHORIZED, 401 TOKEN_EXPIRED,
401 TOKEN_REVOKED, 403 CSRF_VALIDATION_FAILED, 404 NOT_FOUND,
423 ACCOUNT_LOCKED, 429 RATE_LIMIT_EXCEEDED, 500 INTERNAL_ERROR
