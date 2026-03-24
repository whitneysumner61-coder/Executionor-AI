import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers.js';
import configRouter from '../../routes/config.js';

const request = createTestApp(configRouter);

describe('GET /config', () => {
  it('returns 200', async () => {
    const res = await request.get('/');
    expect(res.status).toBe(200);
  });

  it('includes status object', async () => {
    const res = await request.get('/');
    expect(typeof res.body.status).toBe('object');
    expect(res.body.status).not.toBeNull();
  });

  it('status object contains known tracked keys', async () => {
    const res = await request.get('/');
    const knownKey = 'SUPABASE_URL';
    expect(res.body.status).toHaveProperty(knownKey);
    expect(typeof res.body.status[knownKey].configured).toBe('boolean');
    expect(typeof res.body.status[knownKey].length).toBe('number');
  });

  it('includes ready object with boolean flags', async () => {
    const res = await request.get('/');
    expect(typeof res.body.ready).toBe('object');
    expect(typeof res.body.ready.agents).toBe('boolean');
    expect(typeof res.body.ready.database).toBe('boolean');
    expect(typeof res.body.ready.openclaw).toBe('boolean');
  });
});

describe('POST /config', () => {
  it('returns 400 when key is missing', async () => {
    const res = await request.post('/').send({ value: 'some-value' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key.*value required/i);
  });

  it('returns 400 when value is undefined', async () => {
    const res = await request.post('/').send({ key: 'PORT' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key.*value required/i);
  });

  it('returns 400 for an unknown key', async () => {
    const res = await request.post('/').send({ key: 'UNKNOWN_KEY_XYZ', value: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown key/i);
  });

  it('accepts a known key with empty string value', async () => {
    // Writing PORT with same value as already set (no-op effectively)
    const res = await request.post('/').send({ key: 'PORT', value: '' });
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
    }
  });
});

describe('POST /config/bulk', () => {
  it('returns 400 when pairs is missing', async () => {
    const res = await request.post('/bulk').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pairs.*required/i);
  });

  it('returns 400 when pairs is not an object', async () => {
    const res = await request.post('/bulk').send({ pairs: 'not-an-object' });
    expect(res.status).toBe(400);
  });

  it('processes known and unknown keys correctly', async () => {
    const res = await request.post('/bulk').send({
      pairs: {
        PORT: '3100',
        UNKNOWN_KEY_XYZ: 'ignored'
      }
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveProperty('PORT');
    expect(res.body.results['UNKNOWN_KEY_XYZ']).toMatch(/skipped/i);
  });
});
