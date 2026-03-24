import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers.js';
import dbRouter from '../../routes/db.js';

const request = createTestApp(dbRouter);

// These tests only exercise request validation — no real Supabase/DB connection needed.

describe('POST /db/select', () => {
  it('returns 400 when neither table nor sql is provided', async () => {
    const res = await request.post('/select').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/table or sql required/i);
  });
});

describe('POST /db/query', () => {
  it('returns 400 when sql is missing', async () => {
    const res = await request.post('/query').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sql required/i);
  });

  it('returns 400 when sql is whitespace only', async () => {
    const res = await request.post('/query').send({ sql: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sql required/i);
  });
});

describe('POST /db/insert', () => {
  it('returns 400 when table is missing', async () => {
    const res = await request.post('/insert').send({ rows: [{ name: 'test' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/table and rows required/i);
  });

  it('returns 400 when rows is missing', async () => {
    const res = await request.post('/insert').send({ table: 'contacts' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/table and rows required/i);
  });

  it('returns 400 when both table and rows are missing', async () => {
    const res = await request.post('/insert').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /db/update', () => {
  it('returns 400 when table is missing', async () => {
    const res = await request.post('/update').send({ id: 1, data: { name: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/table, id, and data required/i);
  });

  it('returns 400 when id is missing', async () => {
    const res = await request.post('/update').send({ table: 'contacts', data: { name: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/table, id, and data required/i);
  });

  it('returns 400 when data is missing', async () => {
    const res = await request.post('/update').send({ table: 'contacts', id: 1 });
    expect(res.status).toBe(400);
  });
});

describe('POST /db/delete', () => {
  it('returns 400 when table is missing', async () => {
    const res = await request.post('/delete').send({ id: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/table and id required/i);
  });

  it('returns 400 when id is missing', async () => {
    const res = await request.post('/delete').send({ table: 'contacts' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/table and id required/i);
  });
});

describe('POST /db/upsert', () => {
  it('returns 400 when table is missing', async () => {
    const res = await request.post('/upsert').send({ rows: [{ id: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/table and rows required/i);
  });

  it('returns 400 when rows is missing', async () => {
    const res = await request.post('/upsert').send({ table: 'contacts' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/table and rows required/i);
  });
});

describe('GET /db/schema', () => {
  it('returns 400 when table query param is missing', async () => {
    const res = await request.get('/schema');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/table required/i);
  });
});

describe('GET /db/tables', () => {
  it('returns 200 with a tables array', async () => {
    // No DB configured so it falls back to static list
    const res = await request.get('/tables');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tables)).toBe(true);
    expect(res.body.tables.length).toBeGreaterThan(0);
  });

  it('returns source field', async () => {
    const res = await request.get('/tables');
    expect(typeof res.body.source).toBe('string');
  });
});
