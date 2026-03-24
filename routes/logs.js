// ── Live log streaming via SSE ────────────────────────────
// Tails any log file and pushes new lines as they appear.
//
// GET /api/logs/stream?path=D:\tools\claude-remote.log&tail=80
//   → SSE stream:
//     {"type":"history","lines":["line1","line2",...]}  — on connect
//     {"type":"line","line":"new log line"}             — on new content
//     {"type":"error","message":"..."}                  — on read error
//
// GET /api/logs/files — list available log files

import { Router } from 'express';
import { readFile, stat, open } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { IS_WINDOWS } from '../services/host-runtime.js';

const router = Router();

const TEMP_DIR = process.env.TEMP || tmpdir();
const KNOWN_LOGS = IS_WINDOWS
  ? [
      { name: 'Execution Relay', path: 'D:\\tools\\claude-remote.log' },
      { name: 'Relay Out', path: `${TEMP_DIR}\\relay_out.log` },
      { name: 'Relay Err', path: `${TEMP_DIR}\\relay_err.log` },
      { name: 'Claw Bridge', path: `${TEMP_DIR}\\claw_out.log` },
      { name: 'Claw Err', path: `${TEMP_DIR}\\claw_err.log` },
      { name: 'Aggregator', path: `${TEMP_DIR}\\agg_out.log` },
      { name: 'Proxy', path: `${TEMP_DIR}\\proxy_out.log` },
      { name: 'ngrok', path: `${TEMP_DIR}\\ngrok_out.log` }
    ]
  : [
      { name: 'Executionor Runtime', path: join(TEMP_DIR, 'executionor.log') },
      { name: 'Ops State', path: join(process.cwd(), 'sessions', 'ops-control.json') },
      { name: 'Relay Out', path: join(TEMP_DIR, 'relay_out.log') },
      { name: 'Relay Err', path: join(TEMP_DIR, 'relay_err.log') },
      { name: 'Claw Bridge', path: join(TEMP_DIR, 'claw_out.log') },
      { name: 'Claw Err', path: join(TEMP_DIR, 'claw_err.log') }
    ];

router.get('/files', async (req, res) => {
  const result = await Promise.all(KNOWN_LOGS.map(async f => {
    try {
      const s = await stat(f.path);
      return { ...f, exists: true, size: s.size, mtime: s.mtime };
    } catch (_) {
      return { ...f, exists: false };
    }
  }));
  res.json(result.filter(f => f.exists));
});

router.get('/stream', async (req, res) => {
  const logPath = req.query.path || KNOWN_LOGS[0]?.path;
  const tailLines = parseInt(req.query.tail || '80');

  res.setHeader('Content-Type',       'text/event-stream');
  res.setHeader('Cache-Control',      'no-cache');
  res.setHeader('Connection',         'keep-alive');
  res.setHeader('X-Accel-Buffering',  'no');
  res.flushHeaders();

  const send = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  };

  let lastSize = 0;

  // Send tail of existing content immediately
  try {
    const content = await readFile(logPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const tail  = lines.slice(-tailLines);
    lastSize = content.length;
    send({ type: 'history', lines: tail });
  } catch (err) {
    send({ type: 'error', message: `Cannot read ${logPath}: ${err.message}` });
    res.end();
    return;
  }

  // Poll for new content every 800ms
  const interval = setInterval(async () => {
    try {
      const s = await stat(logPath);
      if (s.size < lastSize) {
        // File was rotated/truncated — re-read from start
        const content = await readFile(logPath, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        lastSize = content.length;
        send({ type: 'reset', lines });
        return;
      }
      if (s.size > lastSize) {
        // Read only the new bytes
        const fh  = await open(logPath, 'r');
        const buf = Buffer.alloc(s.size - lastSize);
        await fh.read(buf, 0, buf.length, lastSize);
        await fh.close();
        lastSize = s.size;
        const newLines = buf.toString('utf8').split('\n').filter(Boolean);
        newLines.forEach(line => send({ type: 'line', line }));
      }
    } catch (_) {}
  }, 800);

  req.on('close', () => clearInterval(interval));
});

export default router;
