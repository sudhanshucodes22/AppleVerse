# 🌌 AppleVerse — E-Commerce Experience

Welcome to **AppleVerse**, a premium, high-fidelity e-commerce experience simulating a next-generation digital storefront. This repository contains the complete frontend architecture and a robust, secure Express/SQLite backend.

---

## 🎨 Design & Frontend Highlights
- **Premium Glassmorphic Design**: Curated modern dark modes, rich styling palettes (HSL tailored), and smooth micro-animations.
- **Dynamic Film Modals**: Integrated intro films across Mac, iPhone, iPad, and Watch with customized, glassmorphic player overlays and animated radar indicators.
- **AirPods Pro Integration**: Implemented highly detailed, direct AirPods product displays swapping generic placeholders out for beautiful, custom generated assets.
- **Interactive Map Hub**: Implemented simulated Indian retail locations (Jaipur, Mumbai, Delhi, Bengaluru) with premium visual feedback.

---

## 🛡️ Robust Backend Architecture
- **SQLite Database Integration**: Complete persistence for users, sessions, carts, and order history.
- **Session Protection**: Dual-token JWT (access & refresh rotation) using HttpOnly cookie strategies for robust CSRF and session hijacking protection.
- **Rate-Limiting & Helmet Protection**: Dynamic safety shields securing all endpoints from automated attacks.
- **New Wishlist Engine**: Dedicated user wishlist saving endpoints (`GET`, `POST`, `DELETE`, and active item checks).
- **Atomic Checkout Logic**: Processes full cart orders, computes local 18% GST invoice records, clears the active user cart, and stores transaction details inside the SQLite order book.
- **Comprehensive Admin Panel**: Secured analytical dashboard querying overall store metrics, registered users, and historical buyer data.

---

## ⚙️ Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file at the root:
```env
PORT=3001
NODE_ENV=development
JWT_ACCESS_SECRET=your_access_secret_key
JWT_REFRESH_SECRET=your_refresh_secret_key
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
BCRYPT_ROUNDS=12
AUTH_RATE_LIMIT=10
API_RATE_LIMIT=60
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173
ADMIN_SECRET=appleverse-admin-dev-2026
```

### 3. Start Development Servers
This runs both the Express backend API (Port 3001) and Vite frontend server (Port 5173) concurrently:
```bash
npm run dev
```

---

## 📑 API Documentation
Refer to [API_REFERENCE.md](./server/API_REFERENCE.md) for endpoint layouts, request formats, responses, and authorization schemas.
