import { Router } from 'express';

import { inspectComposeStack, listComposeStacks, runComposeStackAction } from '../services/compose-stacks.js';

const router = Router();

router.get('/stacks', async (req, res) => {
  try {
    res.json({ stacks: await listComposeStacks() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stacks/:id', async (req, res) => {
  try {
    res.json(await inspectComposeStack(req.params.id));
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

router.post('/stacks/:id/up', async (req, res) => {
  try {
    res.json(await runComposeStackAction(req.params.id, 'up', req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/stacks/:id/down', async (req, res) => {
  try {
    res.json(await runComposeStackAction(req.params.id, 'down', req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/stacks/:id/config', async (req, res) => {
  try {
    res.json(await runComposeStackAction(req.params.id, 'config', req.query || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/stacks/:id/logs', async (req, res) => {
  try {
    res.json(await runComposeStackAction(req.params.id, 'logs', req.query || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
