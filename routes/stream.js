// ── Streaming local agent route ───────────────────────────
// Streams local routing updates over SSE so the UI can show typing-in effect.
// GET /api/stream?agentId=SHELL&command=...&history=[]
// (also accepts POST body for longer payloads)
//
// SSE events:
//   data: {"type":"token","text":"..."}   — each token chunk
//   data: {"type":"parsed","data":{...}}  — final structured result
//   data: {"type":"exec_start","cmd":"..."} — PS execution starting
//   data: {"type":"exec_line","line":"...","stream":"stdout|stderr"}
//   data: {"type":"exec_done","exitCode":0}
//   data: {"type":"error","message":"..."}
//   data: {"type":"done"}                 — stream complete

import { Router } from 'express';
import { spawn }   from 'child_process';
import { broadcast } from '../services/ws-manager.js';
import { dispatchLocalAgent } from '../services/local-agent.js';

const router = Router();

const PS_ENV = {
  ...process.env,
  PATH: `D:\\npm-global;C:\\Program Files\\nodejs;${process.env.PATH}`
};

// ── SSE helper ────────────────────────────────────────────
function sseSetup(res) {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  return (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function streamText(send, text) {
  const chunks = String(text).match(/.{1,36}/g) || [];
  for (const chunk of chunks) send({ type: 'token', text: chunk });
}

// ── Stream endpoint (GET for EventSource, POST for large payloads) ─
async function handleStream(agentId, command, history, send, res) {
  broadcast({ type: 'agent:thinking', agentId, command });

  try {
    const { agentId: resolvedAgentId, parsed } = await dispatchLocalAgent({ agentId, command, history });
    const summary = [
      `Local router selected ${resolvedAgentId}.`,
      parsed.explanation || 'Preparing a structured action.',
      'No paid model calls are used for this workflow.'
    ].join(' ');
    await streamText(send, summary);
    send({ type: 'parsed', data: parsed });

    // Execute PS command if applicable
    if (parsed?.type === 'ps') {
      await streamPS(parsed.command, resolvedAgentId, send);
    }

    broadcast({ type: 'agent:response', agentId: resolvedAgentId, parsed });
    send({ type: 'done' });

  } catch (err) {
    send({ type: 'error', message: err.message });
    broadcast({ type: 'agent:error', agentId, error: err.message });
  }
}

// ── Stream PS execution inline ────────────────────────────
function streamPS(command, agentId, send) {
  return new Promise(resolve => {
    send({ type: 'exec_start', cmd: command });
    const proc = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { env: PS_ENV }
    );
    proc.stdout.on('data', d =>
      d.toString().split('\n').filter(l => l.trim()).forEach(line =>
        send({ type: 'exec_line', line, stream: 'stdout' })
      )
    );
    proc.stderr.on('data', d =>
      send({ type: 'exec_line', line: d.toString().trim(), stream: 'stderr' })
    );
    proc.on('close', code => { send({ type: 'exec_done', exitCode: code }); resolve(); });
    proc.on('error', err => { send({ type: 'exec_line', line: `[ERROR] ${err.message}`, stream: 'stderr' }); resolve(); });
    setTimeout(() => { proc.kill(); send({ type: 'exec_line', line: '[TIMEOUT]', stream: 'stderr' }); resolve(); }, 30000);
  });
}

router.get('/', async (req, res) => {
  const { agentId, command, history } = req.query;
  if (!agentId || !command) return res.status(400).json({ error: 'agentId and command required' });
  const send = sseSetup(res);
  let hist = [];
  try { hist = JSON.parse(history || '[]'); } catch (_) {}
  await handleStream(agentId, command, hist, send, res);
  res.end();
});

router.post('/', async (req, res) => {
  const { agentId, command, history } = req.body;
  if (!agentId || !command) return res.status(400).json({ error: 'agentId and command required' });
  const send = sseSetup(res);
  await handleStream(agentId, command, history, send, res);
  res.end();
});

export default router;
