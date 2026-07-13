/**
 * AppleVerse — Frontend Auth Manager (src/auth.js)
 * Handles: token storage, API calls, auth state, redirect guards
 */

const API = '/api';

// ─── State ─────────────────────────────────────────────────────────────
let _accessToken = null;          // Kept only in memory (not localStorage!)
let _user = null;
let _csrfToken = null;
let _refreshPromise = null;       // Deduplicate concurrent refresh calls

// ─── CSRF Token Fetching ──────────────────────────────────────────────
async function fetchCsrfToken() {
  if (_csrfToken) return _csrfToken;
  // Read from cookie first (set by server on any request)
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]+)/);
  if (match) { _csrfToken = decodeURIComponent(match[1]); return _csrfToken; }
  // Fetch from server if not in cookie
  const res = await fetch(`${API}/auth/csrf`, { credentials: 'include' });
  const data = await res.json();
  _csrfToken = data.csrfToken || '';
  return _csrfToken;
}

// ─── Authenticated Fetch ──────────────────────────────────────────────
export async function apiFetch(path, options = {}) {
  const csrf = await fetchCsrfToken();

  const config = {
    credentials: 'include',     // Always send cookies (refresh token)
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
      ...(options.headers || {}),
    },
  };

  // Attach access token if we have one
  if (_accessToken) {
    config.headers['Authorization'] = `Bearer ${_accessToken}`;
  }

  let res = await fetch(`${API}${path}`, config);

  // Auto-refresh if access token expired (401 TOKEN_EXPIRED)
  if (res.status === 401) {
    const body = await res.clone().json().catch(() => ({}));
    if (body.code === 'TOKEN_EXPIRED') {
      const refreshed = await silentRefresh();
      if (refreshed) {
        // Retry with new token
        config.headers['Authorization'] = `Bearer ${_accessToken}`;
        res = await fetch(`${API}${path}`, config);
      } else {
        clearAuth();
        redirectToLogin('Session expired. Please log in again.');
        return null;
      }
    }
  }

  return res;
}

// ─── Silent Token Refresh ─────────────────────────────────────────────
async function silentRefresh() {
  if (_refreshPromise) return _refreshPromise; // Deduplicate
  _refreshPromise = (async () => {
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return false;
      const data = await res.json();
      _accessToken = data.accessToken;
      _user = data.user;
      updateNavUI();
      return true;
    } catch {
      return false;
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

// ─── Auth Actions ─────────────────────────────────────────────────────
export async function register({ name, email, password }) {
  const csrf = await fetchCsrfToken();
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ name, email, password }),
  });
  const data = await res.json();
  if (res.ok && data.accessToken) {
    _accessToken = data.accessToken;
    _user = data.user;
    updateNavUI();
  }
  return { ok: res.ok, status: res.status, data };
}

export async function login({ email, password }) {
  const csrf = await fetchCsrfToken();
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (res.ok && data.accessToken) {
    _accessToken = data.accessToken;
    _user = data.user;
    updateNavUI();
    // Auto-sync guest cart to server cart
    _syncGuestCart().catch(() => {});
  }
  return { ok: res.ok, status: res.status, data };
}

async function _syncGuestCart() {
  const LOCAL_CART_KEY = 'av_guest_cart';
  try {
    const items = JSON.parse(localStorage.getItem(LOCAL_CART_KEY) || '[]');
    if (!items.length) return;
    const csrf = await fetchCsrfToken();
    await fetch(`${API}/cart/sync`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Authorization': `Bearer ${_accessToken}` },
      body: JSON.stringify({ items }),
    });
    localStorage.removeItem(LOCAL_CART_KEY);
  } catch { /* silent */ }
}

export async function logout() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch { /* silent */ }
  clearAuth();
  window.location.href = '/index.html';
}

// ─── Session Init (call on every page load) ───────────────────────────
export async function initAuth() {
  // Try to restore session via refresh token (stored in HttpOnly cookie)
  const restored = await silentRefresh();
  updateNavUI();
  return restored;
}

// ─── Guard: Redirect if not authenticated ────────────────────────────
export async function requireAuth(redirectMsg = '') {
  const authenticated = await initAuth();
  if (!authenticated) {
    redirectToLogin(redirectMsg || 'Please log in to continue.');
    return false;
  }
  return true;
}

// ─── Guard: Redirect if already authenticated ─────────────────────────
export async function redirectIfAuthenticated(dest = '/account.html') {
  const authenticated = await initAuth();
  if (authenticated) window.location.href = dest;
}

// ─── Internal Helpers ─────────────────────────────────────────────────
function clearAuth() {
  _accessToken = null;
  _user = null;
  updateNavUI();
}

function redirectToLogin(message = '') {
  const url = new URL('/login.html', window.location.origin);
  if (message) url.searchParams.set('msg', message);
  window.location.href = url.toString();
}

export function getUser() { return _user; }
export function isAuthenticated() { return !!_accessToken && !!_user; }

// ─── Dynamic Nav Auth UI ─────────────────────────────────────────────
function updateNavUI() {
  const navEl = document.getElementById('main-nav');
  if (!navEl) return;

  const existingAuthZone = navEl.querySelector('[data-auth-zone]');
  const cartBtn = navEl.querySelector('[data-cart-btn]');

  if (existingAuthZone) existingAuthZone.remove();

  const zone = document.createElement('div');
  zone.setAttribute('data-auth-zone', '');
  zone.className = 'flex items-center gap-3';

  if (_user) {
    zone.innerHTML = `
      <span class="hidden md:block text-[13px] font-medium text-[#1D1D1F]">Hi, ${escHtml(_user.name.split(' ')[0])}</span>
      <a href="/account.html" aria-label="My Account"
         class="material-symbols-outlined text-[#1D1D1F] hover:text-[#0066CC] transition-colors text-[22px]">person</a>
      <button id="nav-logout-btn" aria-label="Sign out" type="button"
         class="material-symbols-outlined text-[#1D1D1F] hover:text-red-500 transition-colors text-[22px]">logout</button>
    `;
  } else {
    zone.innerHTML = `
      <a href="/login.html"
         class="text-[13px] font-medium text-[#0066CC] hover:underline transition-colors">Sign In</a>
      <a href="/signup.html"
         class="text-[13px] font-medium bg-[#0066CC] text-white px-4 py-1.5 rounded-full hover:brightness-110 transition-all">Sign Up</a>
    `;
  }

  if (cartBtn) {
    cartBtn.insertAdjacentElement('afterend', zone);
  } else {
    navEl.appendChild(zone);
  }

  navEl.querySelector('#nav-logout-btn')?.addEventListener('click', logout);
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ─── Password Strength Checker ────────────────────────────────────────
export function checkPasswordStrength(password) {
  const checks = {
    length:    password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number:    /[0-9]/.test(password),
    special:   /[^A-Za-z0-9]/.test(password),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF'];
  return { checks, score, label: labels[score - 1] || 'Very Weak', color: colors[score - 1] || colors[0] };
}
