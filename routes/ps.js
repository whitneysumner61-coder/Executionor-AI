// ── Process manager route ─────────────────────────────────
// Tracks spawned PS processes, lets you kill them by sessionId
// GET  /api/ps/running         → list active sessions
// POST /api/ps/kill/:sessionId → kill a specific session
// POST /api/ps/killall         → kill everything

import { Router } from 'express';
import { spawn } from 'child_process';
import { buildShellArgs, IS_WINDOWS, SHELL_ENV, SHELL_EXECUTABLE, SHELL_LABEL } from '../services/host-runtime.js';
import { broadcast } from '../services/ws-manager.js';

export const router = Router();

// Track all active processes
const activeSessions = new Map(); // sessionId → { proc, command, startedAt }
const history = [];

// ── Sync execution (used by agents) ──────────────────────
export function runPSSync(command, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const lines = [];
    const proc = spawn(SHELL_EXECUTABLE, buildShellArgs(command), { env: SHELL_ENV });

    proc.stdout.on('data', d => {
      d.toString().split('\n').forEach(l => { if (l.trim()) lines.push(l); });
    });
    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg) lines.push(`[ERR] ${msg}`);
    });
    proc.on('close', code => {
      if (code !== 0 && code !== null) lines.push(`[Exit: ${code}]`);
      resolve(lines);
    });
    proc.on('error', err => resolve([`[SPAWN ERROR] ${err.message}`]));

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve([...lines, '[TIMEOUT — killed after 30s]']);
    }, timeoutMs);

    proc.on('close', () => clearTimeout(timer));
  });
}

// ── Async streaming execution (WS broadcast) ─────────────
export function runPSStream(command, sessionId) {
  broadcast({ type: 'ps:start', sessionId, command });

  const proc = spawn(SHELL_EXECUTABLE, buildShellArgs(command), { env: SHELL_ENV });

  activeSessions.set(sessionId, { proc, command, startedAt: new Date().toISOString() });
  history.unshift({ sessionId, command, ts: new Date().toISOString() });
  if (history.length > 100) history.pop();

  proc.stdout.on('data', d => {
    d.toString().split('\n').forEach(line => {
      if (line) broadcast({ type: 'ps:line', sessionId, line, stream: 'stdout' });
    });
  });
  proc.stderr.on('data', d => {
    broadcast({ type: 'ps:line', sessionId, line: d.toString().trim(), stream: 'stderr' });
  });
  proc.on('close', code => {
    activeSessions.delete(sessionId);
    broadcast({ type: 'ps:done', sessionId, exitCode: code });
  });
  proc.on('error', err => {
    activeSessions.delete(sessionId);
    broadcast({ type: 'ps:error', sessionId, error: err.message });
  });

  const timer = setTimeout(() => {
    proc.kill('SIGKILL');
    activeSessions.delete(sessionId);
    broadcast({ type: 'ps:timeout', sessionId });
  }, 30000);

  proc.on('close', () => clearTimeout(timer));
  return sessionId;
}

// ── REST endpoints ────────────────────────────────────────
router.post('/exec', async (req, res) => {
  const { command, sync } = req.body;
  if (!command) return res.status(400).json({ error: 'command required' });

  const sessionId = `ps_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  if (sync) {
    const output = await runPSSync(command);
    return res.json({ sessionId, output, ts: new Date().toISOString(), shell: SHELL_LABEL });
  }

  runPSStream(command, sessionId);
  res.json({ sessionId, status: 'streaming', shell: SHELL_LABEL, message: `Lines streaming via WebSocket /ws (${SHELL_LABEL})` });
});

router.get('/running', (req, res) => {
  const running = [];
  for (const [id, info] of activeSessions.entries()) {
    running.push({ sessionId: id, command: info.command, startedAt: info.startedAt });
  }
  res.json({ count: running.length, sessions: running });
});

router.post('/kill/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or already finished' });
  session.proc.kill('SIGKILL');
  activeSessions.delete(sessionId);
  broadcast({ type: 'ps:killed', sessionId });
  res.json({ success: true, sessionId });
});

router.post('/killall', (req, res) => {
  const killed = [];
  for (const [id, info] of activeSessions.entries()) {
    info.proc.kill('SIGKILL');
    killed.push(id);
  }
  activeSessions.clear();
  broadcast({ type: 'ps:killall', count: killed.length });
  res.json({ killed });
});

router.get('/history', (req, res) => {
  res.json(history.slice(0, 50));
});

export default router;
export { IS_WINDOWS, SHELL_EXECUTABLE, SHELL_LABEL };
