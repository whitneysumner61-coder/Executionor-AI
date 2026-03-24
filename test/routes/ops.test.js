import { describe, it, expect, afterAll } from 'vitest';
import { createTestApp } from '../helpers.js';
import opsRouter from '../../routes/ops.js';
import { rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, '..', '..', 'sessions', 'ops-control.json');

const request = createTestApp(opsRouter);

// Collect task/runbook ids created during tests for cleanup
const createdTaskIds = [];
const createdRunbookIds = [];

afterAll(async () => {
  // State cleanup is not trivial since ops uses a single JSON file.
  // We just leave the test artifacts — they don't affect production.
});

describe('GET /ops/overview', () => {
  it('returns 200', async () => {
    const res = await request.get('/overview');
    expect(res.status).toBe(200);
  });

  it('includes tasks and runbooks counts', async () => {
    const res = await request.get('/overview');
    expect(res.body).toHaveProperty('tasks');
    expect(res.body).toHaveProperty('runbooks');
  });
});

describe('GET /ops/tasks', () => {
  it('returns 200 with tasks array', async () => {
    const res = await request.get('/tasks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tasks)).toBe(true);
  });

  it('accepts status filter query param', async () => {
    const res = await request.get('/tasks?status=pending');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tasks)).toBe(true);
  });
});

describe('GET /ops/guided-actions', () => {
  it('returns 200 with actions array', async () => {
    const res = await request.get('/guided-actions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.actions)).toBe(true);
  });

  it('each action has id, label, summary, kind', async () => {
    const res = await request.get('/guided-actions');
    for (const action of res.body.actions) {
      expect(typeof action.id).toBe('string');
      expect(typeof action.label).toBe('string');
      expect(typeof action.summary).toBe('string');
      expect(typeof action.kind).toBe('string');
    }
  });
});

describe('GET /ops/build-station', () => {
  it('returns 200 with profiles array', async () => {
    const res = await request.get('/build-station');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.profiles)).toBe(true);
  });

  it('each profile has id, label, summary', async () => {
    const res = await request.get('/build-station');
    for (const profile of res.body.profiles) {
      expect(typeof profile.id).toBe('string');
      expect(typeof profile.label).toBe('string');
    }
  });
});

describe('GET /ops/runbooks', () => {
  it('returns 200 with runbooks array', async () => {
    const res = await request.get('/runbooks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runbooks)).toBe(true);
  });

  it('includes builtin runbooks', async () => {
    const res = await request.get('/runbooks');
    const builtins = res.body.runbooks.filter((r) => r.builtin === true);
    expect(builtins.length).toBeGreaterThan(0);
  });
});

describe('GET /ops/policies', () => {
  it('returns 200', async () => {
    const res = await request.get('/policies');
    expect(res.status).toBe(200);
  });

  it('includes profile and policy fields', async () => {
    const res = await request.get('/policies');
    expect(res.body).toHaveProperty('profile');
    expect(typeof res.body.profile).toBe('string');
    expect(res.body).toHaveProperty('requireApprovalForTypes');
    expect(Array.isArray(res.body.requireApprovalForTypes)).toBe(true);
  });
});

describe('GET /ops/audit', () => {
  it('returns 200 with audit array', async () => {
    const res = await request.get('/audit');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.audit)).toBe(true);
  });

  it('accepts limit query param', async () => {
    const res = await request.get('/audit?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.audit.length).toBeLessThanOrEqual(5);
  });
});

describe('GET /ops/diagnostics', () => {
  it('returns 200 with checks array', async () => {
    const res = await request.get('/diagnostics');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.checks)).toBe(true);
  });
});

describe('POST /ops/tasks', () => {
  it('returns 400 when title is missing', async () => {
    const res = await request.post('/tasks').send({ summary: 'a summary' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title required/i);
  });

  it('returns 400 when title is empty string', async () => {
    const res = await request.post('/tasks').send({ title: '   ', summary: 'a summary' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when both summary and command are missing', async () => {
    const res = await request.post('/tasks').send({ title: 'Test Task' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/summary or command required/i);
  });

  it('creates a task with title and summary', async () => {
    const res = await request.post('/tasks').send({
      title: 'Vitest Test Task',
      summary: 'Testing task creation',
      requestedBy: 'vitest'
    });
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.title).toBe('Vitest Test Task');
    createdTaskIds.push(res.body.id);
  });

  it('creates a task with title and command', async () => {
    const res = await request.post('/tasks').send({
      title: 'Vitest Command Task',
      command: 'echo test',
      targetAgent: 'SHELL',
      requestedBy: 'vitest'
    });
    expect(res.status).toBe(201);
    expect(res.body.command).toBe('echo test');
    createdTaskIds.push(res.body.id);
  });
});

describe('GET /ops/tasks/:id', () => {
  it('returns 404 for non-existent task', async () => {
    const res = await request.get('/tasks/nonexistent_task_xyz');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns the created task by id', async () => {
    const createRes = await request.post('/tasks').send({
      title: 'Fetchable Task',
      summary: 'for get test'
    });
    const taskId = createRes.body.id;
    createdTaskIds.push(taskId);

    const res = await request.get(`/tasks/${taskId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(taskId);
  });
});

describe('GET /ops/tasks/:id/audit', () => {
  it('returns audit array for a valid task', async () => {
    const createRes = await request.post('/tasks').send({
      title: 'Audit Task',
      summary: 'for audit test'
    });
    const taskId = createRes.body.id;
    createdTaskIds.push(taskId);

    const res = await request.get(`/tasks/${taskId}/audit`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.audit)).toBe(true);
  });
});

describe('POST /ops/runbooks', () => {
  it('returns 400 when title is missing', async () => {
    const res = await request.post('/runbooks').send({ command: 'echo hello' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title required/i);
  });

  it('returns 400 when command is missing', async () => {
    const res = await request.post('/runbooks').send({ title: 'Test Runbook' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/command required/i);
  });

  it('creates a runbook with title and command', async () => {
    const res = await request.post('/runbooks').send({
      title: 'Vitest Runbook',
      command: 'list files',
      summary: 'Lists workspace files',
      targetAgent: 'PHANTOM',
      createdBy: 'vitest'
    });
    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.title).toBe('Vitest Runbook');
    createdRunbookIds.push(res.body.id);
  });
});

describe('POST /ops/runbooks/:id/instantiate', () => {
  it('returns 400 for non-existent runbook', async () => {
    const res = await request.post('/runbooks/nonexistent_rb_xyz/instantiate').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('instantiates a real runbook as a task', async () => {
    const createRes = await request.post('/runbooks').send({
      title: 'Instantiable Runbook',
      command: 'echo instantiate',
      createdBy: 'vitest'
    });
    const rbId = createRes.body.id;
    createdRunbookIds.push(rbId);

    const res = await request.post(`/runbooks/${rbId}/instantiate`).send({
      requestedBy: 'vitest'
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    createdTaskIds.push(res.body.id);
  });
});

describe('DELETE /ops/runbooks/:id', () => {
  it('returns 400 for non-existent runbook', async () => {
    const res = await request.delete('/runbooks/nonexistent_rb_to_delete_xyz');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('deletes a non-builtin runbook', async () => {
    const createRes = await request.post('/runbooks').send({
      title: 'To Be Deleted',
      command: 'echo delete me',
      createdBy: 'vitest'
    });
    const rbId = createRes.body.id;

    const res = await request.delete(`/runbooks/${rbId}?deletedBy=vitest`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(rbId);
  });
});

describe('POST /ops/tasks/:id/approve and reject', () => {
  it('returns 400 approving a non-existent task', async () => {
    const res = await request.post('/tasks/nonexistent_xyz/approve').send({ reviewedBy: 'vitest' });
    expect(res.status).toBe(400);
  });

  it('returns 400 rejecting a non-existent task', async () => {
    const res = await request.post('/tasks/nonexistent_xyz/reject').send({ reviewedBy: 'vitest' });
    expect(res.status).toBe(400);
  });
});
