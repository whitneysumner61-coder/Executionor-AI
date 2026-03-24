import { Router } from 'express';

import {
  collectOpsDiagnostics,
  createOpsRunbook,
  createOpsTask,
  deleteOpsRunbook,
  decideOpsTask,
  getOpsPolicies,
  getOpsTask,
  getOpsOverview,
  instantiateOpsRunbook,
  listOpsAudit,
  listOpsRunbooks,
  listOpsTaskAudit,
  listOpsTasks,
  runOpsTask,
  updateOpsPolicies
} from '../services/ops-control.js';
import { broadcast } from '../services/ws-manager.js';

const router = Router();

function emitOpsUpdate(type, payload = {}) {
  broadcast({
    type: 'ops:update',
    event: type,
    ...payload
  });
}

router.get('/overview', async (req, res) => {
  try {
    res.json(await getOpsOverview());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/tasks', async (req, res) => {
  try {
    res.json({ tasks: await listOpsTasks(req.query.status) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/tasks/:id', async (req, res) => {
  try {
    res.json(await getOpsTask(req.params.id));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

router.get('/tasks/:id/audit', async (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit || '20', 10);
    res.json({ audit: await listOpsTaskAudit(req.params.id, Number.isNaN(limit) ? 20 : limit) });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

router.get('/runbooks', async (req, res) => {
  try {
    res.json({ runbooks: await listOpsRunbooks() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/policies', async (req, res) => {
  try {
    res.json(await getOpsPolicies());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tasks', async (req, res) => {
  const { title, summary, command, targetAgent, requestedBy, requiresApproval, metadata } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  if (!summary?.trim() && !command?.trim()) return res.status(400).json({ error: 'summary or command required' });

  try {
    const task = await createOpsTask({
      title,
      summary,
      command,
      targetAgent,
      requestedBy,
      requiresApproval,
      metadata
    });
    emitOpsUpdate('task.created', { taskId: task.id });
    res.status(201).json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/runbooks', async (req, res) => {
  const { title, summary, command, targetAgent, requiresApproval, tags, createdBy } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  if (!command?.trim()) return res.status(400).json({ error: 'command required' });

  try {
    const runbook = await createOpsRunbook({
      title,
      summary,
      command,
      targetAgent,
      requiresApproval,
      tags,
      createdBy
    });
    emitOpsUpdate('runbook.created', { runbookId: runbook.id });
    res.status(201).json(runbook);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/runbooks/:id/instantiate', async (req, res) => {
  try {
    const task = await instantiateOpsRunbook(req.params.id, req.body || {});
    emitOpsUpdate('runbook.instantiated', { runbookId: req.params.id, taskId: task.id });
    res.status(201).json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/runbooks/:id', async (req, res) => {
  try {
    const runbook = await deleteOpsRunbook(req.params.id, req.query.deletedBy || req.body?.deletedBy || 'operator');
    emitOpsUpdate('runbook.deleted', { runbookId: runbook.id });
    res.json(runbook);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/policies', async (req, res) => {
  try {
    const policies = await updateOpsPolicies(req.body || {}, req.body?.updatedBy || 'operator');
    emitOpsUpdate('policy.updated', { profile: policies.profile });
    res.json(policies);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/tasks/:id/approve', async (req, res) => {
  try {
    const task = await decideOpsTask(req.params.id, 'approve', req.body.reviewedBy, req.body.note);
    emitOpsUpdate('task.approved', { taskId: task.id });
    res.json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/tasks/:id/reject', async (req, res) => {
  try {
    const task = await decideOpsTask(req.params.id, 'reject', req.body.reviewedBy, req.body.note);
    emitOpsUpdate('task.rejected', { taskId: task.id });
    res.json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/tasks/:id/run', async (req, res) => {
  try {
    const task = await runOpsTask(req.params.id, req.body.requestedBy || 'operator');
    emitOpsUpdate('task.run_completed', { taskId: task.id });
    res.json(task);
  } catch (error) {
    emitOpsUpdate('task.run_failed', { taskId: req.params.id, error: error.message });
    res.status(400).json({ error: error.message, task: error.task || null });
  }
});

router.get('/audit', async (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit || '40', 10);
    res.json({ audit: await listOpsAudit(Number.isNaN(limit) ? 40 : limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/diagnostics', async (req, res) => {
  try {
    res.json({ checks: await collectOpsDiagnostics() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
