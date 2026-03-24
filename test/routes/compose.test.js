import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers.js';
import composeRouter from '../../routes/compose.js';

const request = createTestApp(composeRouter);

describe('GET /compose/stacks', () => {
  it('returns 200', async () => {
    const res = await request.get('/stacks');
    expect(res.status).toBe(200);
  });

  it('returns a stacks array (may be empty when docker is not available)', async () => {
    const res = await request.get('/stacks');
    expect(Array.isArray(res.body.stacks)).toBe(true);
  });
});

describe('GET /compose/stacks/:id', () => {
  it('returns 404 for a non-existent stack id', async () => {
    const res = await request.get('/stacks/nonexistent_stack_xyz');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /compose/stacks/:id/up', () => {
  it('returns 400 for a non-existent stack id', async () => {
    const res = await request.post('/stacks/nonexistent_xyz/up').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /compose/stacks/:id/down', () => {
  it('returns 400 for a non-existent stack id', async () => {
    const res = await request.post('/stacks/nonexistent_xyz/down').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /compose/stacks/:id/config', () => {
  it('returns 400 for a non-existent stack id', async () => {
    const res = await request.get('/stacks/nonexistent_xyz/config');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /compose/stacks/:id/logs', () => {
  it('returns 400 for a non-existent stack id', async () => {
    const res = await request.get('/stacks/nonexistent_xyz/logs');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
