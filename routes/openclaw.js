// ── OpenClaw bridge route ────────────────────────────────
// GET  /api/openclaw/status
// POST /api/openclaw/message   { channel, message }
// GET  /api/openclaw/channels
// GET  /api/openclaw/agents
import { Router } from 'express';

const router = Router();
const RELAY_URL  = process.env.OPENCLAW_RELAY_URL  || 'http://localhost:4588';
const BRIDGE_URL = process.env.OPENCLAW_BRIDGE_URL || 'http://localhost:3004';
const TOKEN      = process.env.OPENCLAW_GATEWAY_TOKEN || '';

async function clawFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) };
  const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers||{}) } });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch(_) { return { ok: res.ok, status: res.status, data: text }; }
}

router.get('/status', async (req, res) => {
  try {
    const relay  = await clawFetch(`${RELAY_URL}/`).catch(() => ({ ok: false, status: 0 }));
    const bridge = await clawFetch(`${BRIDGE_URL}/health`).catch(() => ({ ok: false, status: 0 }));
    res.json({
      relay:  { url: RELAY_URL,  reachable: relay.ok  || relay.status === 404, status: relay.status },
      bridge: { url: BRIDGE_URL, reachable: bridge.ok || bridge.status === 400, status: bridge.status }
    });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/channels', async (req, res) => {
  try {
    const r = await clawFetch(`${BRIDGE_URL}/mcp`, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'claw_channels_list', arguments: {} } })
    });
    res.json(r.data);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/message', async (req, res) => {
  const { channel, message } = req.body;
  if (!channel || !message) return res.status(400).json({ error: 'channel and message required' });
  try {
    const r = await clawFetch(`${BRIDGE_URL}/mcp`, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'claw_send_message', arguments: { channel_id: channel, message } } })
    });
    res.json(r.data);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agents', async (req, res) => {
  try {
    const r = await clawFetch(`${BRIDGE_URL}/mcp`, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'claw_agents_list', arguments: {} } })
    });
    res.json(r.data);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
