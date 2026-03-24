// ── Local agent dispatch route ───────────────────────────
// POST /api/agents/dispatch  { agentId, command, history? }
// GET  /api/agents/list
import { Router } from 'express';
import { runPSSync } from './ps.js';
import { broadcast } from '../services/ws-manager.js';
import { LOCAL_AGENTS, dispatchLocalAgent } from '../services/local-agent.js';

const router = Router();

// ── Dispatch an agent ────────────────────────────────────
router.post('/dispatch', async (req, res) => {
  const { agentId, command, history = [] } = req.body;
  if (!agentId || !command) return res.status(400).json({ error: 'agentId and command required' });

  broadcast({ type: 'agent:thinking', agentId, command });

  try {
    const result = await dispatchLocalAgent({ agentId, command, history });
    const { agentId: resolvedAgentId, parsed } = result;

    // Execute the action
    let executionResult = null;
    if (parsed.type === 'ps') {
      executionResult = await runPSSync(parsed.command);
      broadcast({ type: 'agent:ps_result', agentId, command: parsed.command, lines: executionResult });
    }

    broadcast({ type: 'agent:response', agentId: resolvedAgentId, parsed, executionResult });
    res.json({ agentId: resolvedAgentId, parsed, executionResult });

  } catch(err) {
    broadcast({ type: 'agent:error', agentId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/list', (req, res) => {
  res.json(Object.values(LOCAL_AGENTS).map(({ id, name, role, description }) => ({ id, name, role, description })));
});

export default router;
