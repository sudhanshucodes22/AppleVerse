// ─── server/services/db.js ────────────────────────────────────────────
// SQLite database — single connection, auto-migrates schema on startup
// v2.1.0: added subtotal/tax to orders, reviews table, graceful shutdown
import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH   = join(__dirname, '..', 'data', 'appleverse.db');
const JSON_PATH = join(__dirname, '..', 'data', 'users.json');

// ─── Open DB ──────────────────────────────────────────────────────────
export const db = new Database(DB_PATH);

// Enable WAL mode for concurrency + performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema Migrations ────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    email                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash         TEXT NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at         TEXT,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until          TEXT,
    is_verified           INTEGER NOT NULL DEFAULT 0,
    deleted_at            TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user  ON refresh_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);

  CREATE TABLE IF NOT EXISTS blacklist (
    jti        TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_blacklist_expires ON blacklist(expires_at);

  CREATE TABLE IF NOT EXISTS orders (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_ref  TEXT NOT NULL,
    items      TEXT NOT NULL,
    subtotal   REAL NOT NULL DEFAULT 0,
    tax        REAL NOT NULL DEFAULT 0,
    total      REAL NOT NULL,
    currency   TEXT NOT NULL DEFAULT 'INR',
    status     TEXT NOT NULL DEFAULT 'Confirmed',
    placed_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_placed  ON orders(placed_at);

  CREATE TABLE IF NOT EXISTS reviews (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating      INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    title       TEXT,
    body        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(product_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_user    ON reviews(user_id);

  CREATE TABLE IF NOT EXISTS cart (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    qty        INTEGER NOT NULL DEFAULT 1,
    color      TEXT,
    storage    TEXT,
    added_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, product_id, color, storage)
  );

  CREATE INDEX IF NOT EXISTS idx_cart_user ON cart(user_id);

  CREATE TABLE IF NOT EXISTS wishlist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    added_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, product_id)
  );

  CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id);

  CREATE TABLE IF NOT EXISTS addresses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name  TEXT NOT NULL,
    phone      TEXT NOT NULL,
    street     TEXT NOT NULL,
    city       TEXT NOT NULL,
    state      TEXT NOT NULL,
    zip        TEXT NOT NULL,
    country    TEXT NOT NULL DEFAULT 'India',
    is_default INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);

  CREATE TABLE IF NOT EXISTS payment_methods (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand      TEXT NOT NULL,
    cardholder TEXT NOT NULL,
    last4      TEXT NOT NULL,
    exp_month  INTEGER NOT NULL,
    exp_year   INTEGER NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_payment_user ON payment_methods(user_id);

  CREATE TABLE IF NOT EXISTS trade_ins (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device          TEXT NOT NULL,
    estimated_value REAL NOT NULL,
    status          TEXT NOT NULL DEFAULT 'Estimated',
    date            TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_trade_user ON trade_ins(user_id);

  CREATE TABLE IF NOT EXISTS applecare (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name   TEXT NOT NULL,
    serial_number TEXT NOT NULL UNIQUE,
    expires_at    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'Active'
  );
  CREATE INDEX IF NOT EXISTS idx_applecare_user ON applecare(user_id);

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    message    TEXT NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

  CREATE TABLE IF NOT EXISTS payment_intents (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount     REAL NOT NULL,
    currency   TEXT NOT NULL DEFAULT 'INR',
    status     TEXT NOT NULL DEFAULT 'pending',
    items      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_payment_intents_user ON payment_intents(user_id);
`);

// ─── JSON → SQLite Migration (runs once on first startup) ─────────────
function migrateFromJson() {
  if (!existsSync(JSON_PATH)) return;
  try {
    const raw    = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
    const users  = raw.users || [];
    const tokens = raw.refreshTokens || [];
    const blist  = raw.blacklist || [];
    if (users.length === 0) return;
    const existingCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
    if (existingCount > 0) return;

    console.log(`[db] Migrating ${users.length} user(s) from users.json to SQLite...`);

    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users
        (id, name, email, password_hash, created_at, updated_at, last_login_at,
         failed_login_attempts, locked_until, is_verified, deleted_at)
      VALUES
        (@id, @name, @email, @passwordHash, @createdAt, @updatedAt, @lastLoginAt,
         @failedLoginAttempts, @lockedUntil, @isVerified, @deletedAt)
    `);
    const insertToken = db.prepare(`
      INSERT OR IGNORE INTO refresh_tokens (user_id, token, expires_at)
      VALUES (@userId, @token, @expiresAt)
    `);
    const insertOrder = db.prepare(`
      INSERT OR IGNORE INTO orders (id, user_id, order_ref, items, total, currency, status, placed_at)
      VALUES (@id, @userId, @orderRef, @items, @total, @currency, @status, @placedAt)
    `);
    const insertBlack = db.prepare(`
      INSERT OR IGNORE INTO blacklist (jti, expires_at) VALUES (@jti, @expiresAt)
    `);

    db.transaction(() => {
      for (const u of users) {
        insertUser.run({
          id: u.id, name: u.name, email: u.email, passwordHash: u.passwordHash,
          createdAt: u.createdAt || new Date().toISOString(),
          updatedAt: u.updatedAt || new Date().toISOString(),
          lastLoginAt: u.lastLoginAt || null,
          failedLoginAttempts: u.failedLoginAttempts || 0,
          lockedUntil: u.lockedUntil || null,
          isVerified: u.isVerified ? 1 : 0,
          deletedAt: u.deletedAt || null,
        });
        if (Array.isArray(u.orders)) {
          for (const o of u.orders) {
            insertOrder.run({
              id: o.id, userId: u.id, orderRef: o.orderRef,
              items: JSON.stringify(o.items), total: o.total,
              currency: o.currency || 'INR', status: o.status || 'Confirmed',
              placedAt: o.placedAt || new Date().toISOString(),
            });
          }
        }
      }
      for (const t of tokens) {
        if (new Date(t.expiresAt) > new Date())
          insertToken.run({ userId: t.userId, token: t.token, expiresAt: t.expiresAt });
      }
      for (const b of blist) {
        if (new Date(b.expiresAt) > new Date())
          insertBlack.run({ jti: b.jti, expiresAt: b.expiresAt });
      }
    })();

    console.log('[db] Migration complete.');
  } catch (err) {
    console.error('[db] Migration from JSON failed (non-fatal):', err.message);
  }
}

migrateFromJson();

// ─── Migration v2.1 — add subtotal/tax to existing orders table ───────
try {
  db.exec(`ALTER TABLE orders ADD COLUMN subtotal REAL NOT NULL DEFAULT 0`);
} catch { /* column already exists — safe to ignore */ }
try {
  db.exec(`ALTER TABLE orders ADD COLUMN tax REAL NOT NULL DEFAULT 0`);
} catch { /* column already exists — safe to ignore */ }

console.log(`[db] SQLite ready: ${DB_PATH}`);

// ─── Graceful Shutdown ────────────────────────────────────────────────
export function closeDb() {
  try {
    db.close();
    console.log('[db] Database connection closed cleanly.');
  } catch (err) {
    console.error('[db] Error closing database:', err.message);
  }
}
