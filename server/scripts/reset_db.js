// ─── server/scripts/reset_db.js ───────────────────────────────────────
// Dev utility: drops and recreates the SQLite database from scratch.
// Usage: node server/scripts/reset_db.js
import { unlinkSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH   = join(__dirname, '..', 'data', 'appleverse.db');
const WAL_PATH  = DB_PATH + '-wal';
const SHM_PATH  = DB_PATH + '-shm';

for (const f of [DB_PATH, WAL_PATH, SHM_PATH]) {
  if (existsSync(f)) { unlinkSync(f); console.log(`Deleted: ${f}`); }
}

console.log('Database reset. Re-importing schema on next server start.');
