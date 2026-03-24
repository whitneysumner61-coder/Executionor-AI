// ── Process manager route ─────────────────────────────────
// Tracks spawned PS processes, lets you kill them by sessionId
// GET  /api/ps/running         → list active sessions
// POST /api/ps/kill/:sessionId → kill a specific session
// POST /api/ps/killall         → kill everything

import { Router } from 'express';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { buildShellArgs, IS_WINDOWS, SHELL_ENV, SHELL_EXECUTABLE, SHELL_LABEL } from '../services/host-runtime.js';
import { broadcast } from '../services/ws-manager.js';

export const router = Router();

// Track all active processes
const activeSessions = new Map(); // sessionId → { proc, command, startedAt }
const history = [];

function runShellDetailed(command, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const lines = [];
    const proc = spawn(SHELL_EXECUTABLE, buildShellArgs(command), { env: SHELL_ENV });
    let closed = false;

    const finish = (result) => {
      if (closed) return;
      closed = true;
      resolve(result);
    };

    proc.stdout.on('data', d => {
      d.toString().split('\n').forEach(l => { if (l.trim()) lines.push(l); });
    });
    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg) lines.push(`[ERR] ${msg}`);
    });
    proc.on('close', code => {
      if (code !== 0 && code !== null) lines.push(`[Exit: ${code}]`);
      finish({ command, output: lines, exitCode: code ?? 0, timedOut: false, shell: SHELL_LABEL });
    });
    proc.on('error', err => finish({ command, output: [`[SPAWN ERROR] ${err.message}`], exitCode: -1, timedOut: false, shell: SHELL_LABEL }));

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      finish({ command, output: [...lines, '[TIMEOUT — killed after 30s]'], exitCode: -1, timedOut: true, shell: SHELL_LABEL });
    }, timeoutMs);

    proc.on('close', () => clearTimeout(timer));
  });
}

function detectRepairPlan(command, output = []) {
  const combined = output.join('\n');

  if (/^\s*npm\b/i.test(command) && existsSync('package.json') && !existsSync('node_modules')) {
    return {
      reason: 'npm dependencies appear missing',
      repairCommand: 'npm install',
      note: 'Installing project dependencies before retrying the original command.'
    };
  }

  if (/^\s*npm\b/i.test(command) && /command not found|Cannot find module/i.test(combined) && existsSync('package.json')) {
    return {
      reason: 'npm command failed with a dependency or script resolution error',
      repairCommand: 'npm install',
      note: 'Refreshing npm dependencies before retrying the original command.'
    };
  }

  if (/^\s*(python|python3|py)\b/i.test(command) && /No module named|ModuleNotFoundError/i.test(combined) && existsSync('requirements.txt')) {
    return {
      reason: 'Python dependencies appear missing',
      repairCommand: 'pip install -r requirements.txt',
      note: 'Installing requirements.txt before retrying the original command.'
    };
  }

  return null;
}

// ── Sync execution (used by agents) ──────────────────────
export async function runPSSync(command, timeoutMs = 30000) {
  const result = await runShellDetailed(command, timeoutMs);
  return result.output;
}

export async function runPSAutoRepair(command, timeoutMs = 30000) {
  const attempts = [];
  const firstRun = await runShellDetailed(command, timeoutMs);
  attempts.push({ phase: 'run', ...firstRun });

  if (firstRun.exitCode === 0 && !firstRun.timedOut) {
    return {
      shell: SHELL_LABEL,
      output: firstRun.output,
      exitCode: firstRun.exitCode,
      repaired: false,
      attempts
    };
  }

  const repairPlan = detectRepairPlan(command, firstRun.output);
  if (!repairPlan) {
    return {
      shell: SHELL_LABEL,
      output: firstRun.output,
      exitCode: firstRun.exitCode,
      repaired: false,
      attempts,
      repairSummary: 'No bounded automatic repair was available for this failure.'
    };
  }

  const repairRun = await runShellDetailed(repairPlan.repairCommand, timeoutMs);
  attempts.push({ phase: 'repair', ...repairRun, reason: repairPlan.reason, note: repairPlan.note });

  if (repairRun.exitCode !== 0 || repairRun.timedOut) {
    return {
      shell: SHELL_LABEL,
      output: [...firstRun.output, '', '[AUTO-REPAIR]', ...repairRun.output],
      exitCode: repairRun.exitCode,
      repaired: false,
      attempts,
      repairSummary: `${repairPlan.note} The repair step did not complete successfully.`
    };
  }

  const rerun = await runShellDetailed(command, timeoutMs);
  attempts.push({ phase: 'rerun', ...rerun });

  return {
    shell: SHELL_LABEL,
    output: rerun.output,
    exitCode: rerun.exitCode,
    repaired: rerun.exitCode === 0 && !rerun.timedOut,
    attempts,
    repairSummary: rerun.exitCode === 0 && !rerun.timedOut
      ? `${repairPlan.note} The original command succeeded on retry.`
      : `${repairPlan.note} The original command still failed after the bounded repair step.`
  };
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
  const { command, sync, autoRepair } = req.body;
  if (!command) return res.status(400).json({ error: 'command required' });

  const sessionId = `ps_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  if (sync) {
    const result = autoRepair ? await runPSAutoRepair(command) : {
      ...(await runShellDetailed(command)),
      repaired: false,
      attempts: []
    };
    return res.json({ sessionId, ...result, ts: new Date().toISOString() });
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
