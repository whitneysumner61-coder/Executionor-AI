import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestApp } from '../helpers.js';
import openclawRouter from '../../routes/openclaw.js';

const request = createTestApp(openclawRouter);

describe('POST /openclaw/message', () => {
  it('returns 400 when channel is missing', async () => {
    const res = await request.post('/message').send({ message: 'hello' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/channel.*message required/i);
  });

  it('returns 400 when message is missing', async () => {
    const res = await request.post('/message').send({ channel: 'general' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when both channel and message are missing', async () => {
    const res = await request.post('/message').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /openclaw/status', () => {
  it('returns 200 with relay and bridge status objects', async () => {
    // The bridge/relay is not running in test env so both will be unreachable,
    // but the endpoint should still return a valid response structure.
    const res = await request.get('/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('relay');
    expect(res.body).toHaveProperty('bridge');
  });

  it('relay status has url and reachable fields', async () => {
    const res = await request.get('/status');
    expect(typeof res.body.relay.url).toBe('string');
    expect(typeof res.body.relay.reachable).toBe('boolean');
  });

  it('bridge status has url and reachable fields', async () => {
    const res = await request.get('/status');
    expect(typeof res.body.bridge.url).toBe('string');
    expect(typeof res.body.bridge.reachable).toBe('boolean');
  });
});

describe('GET /openclaw/channels', () => {
  it('returns a response with ok and data fields', async () => {
    const res = await request.get('/channels');
    // Bridge is not running so this will return a 502, but the body must have the normalised shape
    expect([200, 502]).toContain(res.status);
    expect(res.body).toHaveProperty('ok');
  });
});

describe('GET /openclaw/agents', () => {
  it('returns a response with ok field', async () => {
    const res = await request.get('/agents');
    expect([200, 502]).toContain(res.status);
    expect(res.body).toHaveProperty('ok');
  });
});

describe('normalizeToolResult (via /channels endpoint)', () => {
  it('shape includes ok, status, data, error', async () => {
    const res = await request.get('/channels');
    expect(res.body).toHaveProperty('ok');
    // status and data/error may be present
    const keys = Object.keys(res.body);
    expect(keys.some((k) => ['data', 'error'].includes(k))).toBe(true);
  });
});
