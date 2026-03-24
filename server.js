// ═══════════════════════════════════════════════════════════
// EXECUTIONOR — Production Server v1.2
// ═══════════════════════════════════════════════════════════
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import psRouter       from './routes/ps.js';
import fsRouter       from './routes/fs.js';
import dbRouter       from './routes/db.js';
import agentsRouter   from './routes/agents.js';
import openclawRouter from './routes/openclaw.js';
import configRouter   from './routes/config.js';
import sessionsRouter from './routes/sessions.js';
import streamRouter   from './routes/stream.js';
import logsRouter     from './routes/logs.js';
import monitorRouter  from './routes/monitor.js';
import opsRouter      from './routes/ops.js';
import composeRouter  from './routes/compose.js';
import { IS_WINDOWS, SHELL_EXECUTABLE, SHELL_LABEL } from './services/host-runtime.js';
import { attachWebSocket } from './services/ws-manager.js';
import { WORKSPACE_ROOT } from './services/local-agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3100;

const app = express();
const httpServer = createServer(app);

// ── Middleware ────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────
app.use('/api/ps',       psRouter);
app.use('/api/fs',       fsRouter);
app.use('/api/db',       dbRouter);
app.use('/api/agents',   agentsRouter);
app.use('/api/openclaw', openclawRouter);
app.use('/api/config',   configRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/stream',   streamRouter);   // SSE token streaming
app.use('/api/logs',     logsRouter);     // SSE log tail
app.use('/api/monitor',  monitorRouter);  // process monitor
app.use('/api/ops',      opsRouter);      // ops control plane
app.use('/api/compose',  composeRouter);  // docker compose agent stacks

// ── Health ────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok', version: '1.2.0',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    workspaceRoot: WORKSPACE_ROOT,
    host: {
      platform: process.platform,
      shell: SHELL_LABEL,
      shellExecutable: SHELL_EXECUTABLE,
      windows: IS_WINDOWS
    },
    env: {
      agents:   true,
      database: !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)),
      rawSQL:   !!(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL),
      openclaw: !!process.env.OPENCLAW_RELAY_URL,
      ops:      true,
      compose:  true,
    }
  });
});

// ── WebSocket ─────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
attachWebSocket(wss);

// ── SPA fallback ──────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

// ── Start ─────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  const ok = (b, msg) => b ? `✓ ${msg}` : `✗ ${msg}`;
  console.log(`
╔══════════════════════════════════════════════╗
║   EXECUTIONOR  v1.2.0   http://localhost:${PORT} ║
║   Stay Visual · Stay Free · Stay Executionor  ║
╚══════════════════════════════════════════════╝

  ${ok(true, 'Agents (local free engine)')}
  ${ok(!!(process.env.SUPABASE_URL), 'Database (Supabase)')}
  ${ok(!!(process.env.SUPABASE_DB_URL||process.env.DATABASE_URL), 'Raw SQL (pg driver)')}
  ${ok(true, `${SHELL_LABEL} executor`)}
  ${ok(true, 'SSE streaming (stream + logs)')}
  ${ok(true, 'Process monitor')}
  ${ok(true, 'Ops control plane')}
  ${ok(true, 'WebSocket real-time')}
`);
});

process.on('SIGINT',  () => { console.log('\nShutting down…'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\nShutting down…'); process.exit(0); });
