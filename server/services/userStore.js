// ─── server/services/userStore.js ─────────────────────────────────────
// SQLite-backed user and token store.
// Drop-in replacement for the old JSON file store — same method signatures.
import { v4 as uuidv4 } from 'uuid';
import { db } from './db.js';

// ─── Helpers ──────────────────────────────────────────────────────────
/** Map a DB row (snake_case) to a JS object (camelCase) */
function rowToUser(row) {
  if (!row) return null;
  return {
    id:                   row.id,
    name:                 row.name,
    email:                row.email,
    passwordHash:         row.password_hash,
    createdAt:            row.created_at,
    updatedAt:            row.updated_at,
    lastLoginAt:          row.last_login_at,
    failedLoginAttempts:  row.failed_login_attempts,
    lockedUntil:          row.locked_until,
    isVerified:           !!row.is_verified,
    deletedAt:            row.deleted_at,
  };
}

// ─── UserStore ────────────────────────────────────────────────────────
export const UserStore = {

  /** Find user by email (case-insensitive, excludes soft-deleted) */
  findByEmail(email) {
    const row = db.prepare(`
      SELECT * FROM users WHERE email = ? AND deleted_at IS NULL
    `).get(email.toLowerCase().trim());
    return rowToUser(row);
  },

  /** Find user by ID */
  findById(id) {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return rowToUser(row);
  },

  /** Create a new user */
  create({ name, email, passwordHash }) {
    const id  = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), email.toLowerCase().trim(), passwordHash, now, now);
    return this.findById(id);
  },

  /** Update user fields (accepts camelCase keys) */
  update(id, fields) {
    const colMap = {
      name:                 'name',
      email:                'email',
      passwordHash:         'password_hash',
      lastLoginAt:          'last_login_at',
      failedLoginAttempts:  'failed_login_attempts',
      lockedUntil:          'locked_until',
      isVerified:           'is_verified',
      deletedAt:            'deleted_at',
    };

    const sets  = ['updated_at = ?'];
    const vals  = [new Date().toISOString()];

    for (const [key, val] of Object.entries(fields)) {
      const col = colMap[key];
      if (col) {
        sets.push(`${col} = ?`);
        vals.push(val ?? null);
      }
    }

    vals.push(id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return this.findById(id);
  },

  /** Increment failed login attempts, lock if threshold reached */
  recordFailedLogin(id, maxAttempts, lockDurationMs) {
    const user = this.findById(id);
    if (!user) return;
    const attempts = (user.failedLoginAttempts || 0) + 1;
    const lockedUntil = attempts >= maxAttempts
      ? new Date(Date.now() + lockDurationMs).toISOString()
      : user.lockedUntil;
    return this.update(id, { failedLoginAttempts: attempts, lockedUntil });
  },

  /** Reset failed login counter on successful login */
  recordSuccessfulLogin(id) {
    return this.update(id, {
      failedLoginAttempts: 0,
      lockedUntil:         null,
      lastLoginAt:         new Date().toISOString(),
    });
  },

  /** Check if account is currently locked */
  isLocked(user) {
    if (!user.lockedUntil) return false;
    if (new Date(user.lockedUntil) > new Date()) return true;
    this.update(user.id, { lockedUntil: null, failedLoginAttempts: 0 });
    return false;
  },

  /** Return safe public user object (no sensitive fields) */
  toPublic(user) {
    const { passwordHash, failedLoginAttempts, lockedUntil, ...safe } = user;
    return safe;
  },

  /** Get orders for a user with pagination (newest first) */
  getOrders(userId, limit = 20, offset = 0) {
    const rows = db.prepare(`
      SELECT * FROM orders WHERE user_id = ? ORDER BY placed_at DESC LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
    const total = db.prepare('SELECT COUNT(*) as n FROM orders WHERE user_id = ?').get(userId).n;
    return {
      orders: rows.map(r => ({
        id:        r.id,
        userId:    r.user_id,
        orderRef:  r.order_ref,
        items:     JSON.parse(r.items),
        subtotal:  r.subtotal || 0,
        tax:       r.tax || 0,
        total:     r.total,
        currency:  r.currency,
        status:    r.status,
        placedAt:  r.placed_at,
      })),
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  },

  /** Append a new order with full financial breakdown */
  addOrder(userId, { orderRef, items, subtotal = 0, tax = 0, total, currency = 'INR', status = 'Confirmed' }) {
    const id       = uuidv4();
    const placedAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO orders (id, user_id, order_ref, items, subtotal, tax, total, currency, status, placed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, orderRef, JSON.stringify(items), subtotal, tax, total, currency, status, placedAt);
    return { id, userId, orderRef, items, subtotal, tax, total, currency, status, placedAt };
  },
};

// ─── TokenStore ───────────────────────────────────────────────────────
export const TokenStore = {

  /** Save a refresh token — allows multi-device login, caps at 5 tokens per user */
  saveRefreshToken(userId, token, expiresAt) {
    // Remove expired tokens for this user first
    db.prepare(`
      DELETE FROM refresh_tokens WHERE user_id = ? AND expires_at < datetime('now')
    `).run(userId);

    // If user already has 5+ active tokens, remove the oldest one (FIFO)
    const count = db.prepare('SELECT COUNT(*) as n FROM refresh_tokens WHERE user_id = ?').get(userId).n;
    if (count >= 5) {
      const oldest = db.prepare(
        'SELECT id FROM refresh_tokens WHERE user_id = ? ORDER BY created_at ASC LIMIT 1'
      ).get(userId);
      if (oldest) db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(oldest.id);
    }

    db.prepare(`
      INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)
    `).run(userId, token, expiresAt);
  },

  /** Find and validate a refresh token */
  findRefreshToken(token) {
    const row = db.prepare('SELECT * FROM refresh_tokens WHERE token = ?').get(token);
    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) {
      this.removeRefreshToken(token);
      return null;
    }
    return { userId: row.user_id, token: row.token, expiresAt: row.expires_at };
  },

  /** Remove a specific refresh token */
  removeRefreshToken(token) {
    db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(token);
  },

  /** Remove all refresh tokens for a user (logout all devices) */
  removeAllForUser(userId) {
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
  },

  /** Blacklist an access token JTI */
  blacklistToken(jti, expiresAt) {
    // Purge expired entries first to keep table small
    db.prepare("DELETE FROM blacklist WHERE expires_at < datetime('now')").run();
    db.prepare('INSERT OR IGNORE INTO blacklist (jti, expires_at) VALUES (?, ?)').run(jti, expiresAt);
  },

  /** Check if an access token JTI is blacklisted */
  isBlacklisted(jti) {
    const row = db.prepare("SELECT 1 FROM blacklist WHERE jti = ? AND expires_at > datetime('now')").get(jti);
    return !!row;
  },
};
