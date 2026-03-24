import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp } from '../helpers.js';
import { router as psRouter } from '../../routes/ps.js';

const request = createTestApp(psRouter);

describe('GET /running', () => {
  it('returns 200 with count and sessions array', async () => {
    const res = await request.get('/running');
    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe('number');
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });

  it('count matches sessions array length', async () => {
    const res = await request.get('/running');
    expect(res.body.count).toBe(res.body.sessions.length);
  });
});

describe('GET /history', () => {
  it('returns 200 with an array', async () => {
    const res = await request.get('/history');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /killall', () => {
  it('returns 200 with a killed array', async () => {
    const res = await request.post('/killall');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.killed)).toBe(true);
  });
});

describe('POST /kill/:sessionId', () => {
  it('returns 404 for a non-existent sessionId', async () => {
    const res = await request.post('/kill/nonexistent_session_id_xyz');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /exec', () => {
  it('returns 400 when command is missing', async () => {
    const res = await request.post('/exec').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/command required/i);
  });

  it('returns 400 when command is empty string', async () => {
    const res = await request.post('/exec').send({ command: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/command required/i);
  });

  it('executes a sync command and returns output', async () => {
    const res = await request
      .post('/exec')
      .send({ command: 'echo hello', sync: true });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sessionId');
    expect(Array.isArray(res.body.output)).toBe(true);
    expect(res.body.exitCode).toBe(0);
  });

  it('returns sessionId and streaming status for async exec', async () => {
    // Async streaming—just verify the initial response shape
    const res = await request
      .post('/exec')
      .send({ command: 'echo streaming_test', sync: false });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sessionId');
    expect(res.body.status).toBe('streaming');
  });

  it('sync exec includes ts timestamp', async () => {
    const res = await request.post('/exec').send({ command: 'echo ts_test', sync: true });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ts');
    expect(() => new Date(res.body.ts)).not.toThrow();
  });

  it('sync exec includes shell label', async () => {
    const res = await request.post('/exec').send({ command: 'echo shell_test', sync: true });
    expect(res.status).toBe(200);
    expect(typeof res.body.shell).toBe('string');
  });

  it('autoRepair flag is accepted without error', async () => {
    const res = await request
      .post('/exec')
      .send({ command: 'echo repair_test', sync: true, autoRepair: false });
    expect(res.status).toBe(200);
  });
});
