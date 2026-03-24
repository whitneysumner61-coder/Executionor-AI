import { describe, it, expect, afterAll } from 'vitest';
import { createTestApp } from '../helpers.js';
import sessionsRouter from '../../routes/sessions.js';
import { rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(__dirname, '..', '..', 'sessions');

const request = createTestApp(sessionsRouter);

// Track session ids created so we can clean up
const createdIds = [];

afterAll(async () => {
  // Remove test session files created during tests
  for (const id of createdIds) {
    try {
      await rm(join(SESSIONS_DIR, `${id}.json`), { force: true });
    } catch (_) {}
  }
});

describe('GET /sessions', () => {
  it('returns 200 with an array', async () => {
    const res = await request.get('/');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /sessions', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = await request.post('/').send({ messages: [] });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when messages is missing', async () => {
    const res = await request.post('/').send({ sessionId: 'test_only_123' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('saves a session and returns success with sanitised id', async () => {
    const sessionId = `test_vitest_${Date.now()}`;
    createdIds.push(sessionId);
    const res = await request.post('/').send({
      sessionId,
      agentId: 'SHELL',
      messages: [{ role: 'user', content: 'hello' }],
      title: 'Test session'
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.id).toBe('string');
  });

  it('sanitises special characters in sessionId', async () => {
    const rawId = 'test vitest session!@#$';
    const res = await request.post('/').send({
      sessionId: rawId,
      messages: [{ role: 'user', content: 'hi' }]
    });
    expect(res.status).toBe(200);
    // Letters, digits, underscores and hyphens only
    expect(res.body.id).toMatch(/^[a-z0-9A-Z_-]+$/);
    createdIds.push(res.body.id);
  });
});

describe('GET /sessions/:id', () => {
  it('returns 404 for non-existent session', async () => {
    const res = await request.get('/nonexistent_session_xyz_99');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('retrieves a previously saved session', async () => {
    const sessionId = `test_retrieve_${Date.now()}`;
    createdIds.push(sessionId);

    await request.post('/').send({
      sessionId,
      agentId: 'HYDRA',
      messages: [{ role: 'user', content: 'retrieve test' }],
      title: 'Retrieve Test'
    });

    const res = await request.get(`/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(sessionId);
    expect(res.body.agentId).toBe('HYDRA');
    expect(Array.isArray(res.body.messages)).toBe(true);
  });
});

describe('DELETE /sessions/:id', () => {
  it('returns 404 for non-existent session', async () => {
    const res = await request.delete('/nonexistent_delete_xyz_99');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('deletes a saved session', async () => {
    const sessionId = `test_delete_${Date.now()}`;

    await request.post('/').send({
      sessionId,
      messages: [{ role: 'user', content: 'to be deleted' }]
    });

    const delRes = await request.delete(`/${sessionId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    // Confirm it's gone
    const getRes = await request.get(`/${sessionId}`);
    expect(getRes.status).toBe(404);
  });
});

describe('Session list ordering', () => {
  it('sessions list returns items sorted by updatedAt descending', async () => {
    const id1 = `test_sort_a_${Date.now()}`;
    const id2 = `test_sort_b_${Date.now() + 10}`;
    createdIds.push(id1, id2);

    await request.post('/').send({ sessionId: id1, messages: [] });
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 20));
    await request.post('/').send({ sessionId: id2, messages: [] });

    const res = await request.get('/');
    expect(res.status).toBe(200);
    const ids = res.body.map((s) => s.id);
    const pos1 = ids.indexOf(id1);
    const pos2 = ids.indexOf(id2);
    // id2 was created later so should appear first (lower index)
    if (pos1 !== -1 && pos2 !== -1) {
      expect(pos2).toBeLessThan(pos1);
    }
  });
});
