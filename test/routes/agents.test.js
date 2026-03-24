import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers.js';
import agentsRouter from '../../routes/agents.js';

const request = createTestApp(agentsRouter);

describe('GET /agents/list', () => {
  it('returns 200 with an array of agents', async () => {
    const res = await request.get('/list');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('each agent has id, name, role, description fields', async () => {
    const res = await request.get('/list');
    for (const agent of res.body) {
      expect(typeof agent.id).toBe('string');
      expect(typeof agent.name).toBe('string');
      expect(typeof agent.role).toBe('string');
      expect(typeof agent.description).toBe('string');
    }
  });

  it('returns at least the known agents (SHELL, PHANTOM, HYDRA, SCRIBE, CLAW)', async () => {
    const res = await request.get('/list');
    const ids = res.body.map((a) => a.id);
    expect(ids).toContain('SHELL');
    expect(ids).toContain('PHANTOM');
    expect(ids).toContain('HYDRA');
    expect(ids).toContain('SCRIBE');
    expect(ids).toContain('CLAW');
  });
});

describe('POST /agents/dispatch', () => {
  it('returns 400 when agentId is missing', async () => {
    const res = await request.post('/dispatch').send({ command: 'echo hello' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/agentId.*command required/i);
  });

  it('returns 400 when command is missing', async () => {
    const res = await request.post('/dispatch').send({ agentId: 'SHELL' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when both agentId and command are missing', async () => {
    const res = await request.post('/dispatch').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('dispatches a HYDRA agent command and returns parsed result', async () => {
    const res = await request.post('/dispatch').send({
      agentId: 'HYDRA',
      command: 'select * from contacts limit 5'
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('agentId', 'HYDRA');
    expect(res.body).toHaveProperty('parsed');
    expect(res.body.parsed).toHaveProperty('type', 'sql');
  });

  it('dispatches a SCRIBE agent command and returns code action', async () => {
    const res = await request.post('/dispatch').send({
      agentId: 'SCRIBE',
      command: 'create a starter node worker script'
    });
    expect(res.status).toBe(200);
    expect(res.body.parsed).toHaveProperty('type', 'code');
  });

  it('dispatches with AUTO agentId and resolves to an agent', async () => {
    const res = await request.post('/dispatch').send({
      agentId: 'AUTO',
      command: 'list files in workspace'
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.agentId).toBe('string');
  });

  it('accepts optional history array', async () => {
    const res = await request.post('/dispatch').send({
      agentId: 'HYDRA',
      command: 'select id from notes limit 3',
      history: [{ role: 'user', content: 'previous message' }]
    });
    expect(res.status).toBe(200);
  });
});
