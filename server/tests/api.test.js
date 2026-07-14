import supertest from 'supertest';
import app from '../index.js';
import { closeDb } from '../services/db.js';

const request = supertest(app);

afterAll(() => {
  closeDb(); // Cleanly close SQLite WAL after tests finish
});

describe('AppleVerse API Core Integration Tests', () => {
  
  // ─── Health Check ──────────────────────────────────────────────────
  test('GET /api/health returns server status and memory usage details', async () => {
    const res = await request.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('version');
    expect(res.body.database.status).toBe('ok');
  });

  // ─── Product Catalog ───────────────────────────────────────────────
  test('GET /api/products returns product array', async () => {
    const res = await request.get('/api/products');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products.length).toBeGreaterThan(0);
  });

  // ─── Authentication Gatekeeping ────────────────────────────────────
  test('POST /api/checkout/create-payment-intent fails when unauthorized', async () => {
    const res = await request.post('/api/checkout/create-payment-intent');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  test('GET /api/user/profile fails when unauthorized', async () => {
    const res = await request.get('/api/user/profile');
    expect(res.status).toBe(401);
  });
});
