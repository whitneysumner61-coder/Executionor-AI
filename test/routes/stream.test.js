import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers.js';
import streamRouter from '../../routes/stream.js';

const request = createTestApp(streamRouter);

describe('GET /stream (validation)', () => {
  it('returns 400 when agentId is missing', async () => {
    const res = await request.get('/?command=echo+hello');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agentId.*command required/i);
  });

  it('returns 400 when command is missing', async () => {
    const res = await request.get('/?agentId=SHELL');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agentId.*command required/i);
  });

  it('returns 400 when both agentId and command are missing', async () => {
    const res = await request.get('/');
    expect(res.status).toBe(400);
  });
});

describe('POST /stream (validation)', () => {
  it('returns 400 when agentId is missing', async () => {
    const res = await request.post('/').send({ command: 'echo hello' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agentId.*command required/i);
  });

  it('returns 400 when command is missing', async () => {
    const res = await request.post('/').send({ agentId: 'SHELL' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agentId.*command required/i);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request.post('/').send({});
    expect(res.status).toBe(400);
  });
});
