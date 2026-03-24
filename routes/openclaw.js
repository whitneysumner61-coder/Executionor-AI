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

function normalizeToolResult(response, fallbackLabel) {
  const payload = response?.data;
  if (!response?.ok) {
    return {
      ok: false,
      status: response?.status || 0,
      data: null,
      error: typeof payload === 'string' ? payload : payload?.error?.message || payload?.error || `${fallbackLabel} request failed`
    };
  }

  const result = payload?.result ?? payload;
  const content = Array.isArray(result?.content) ? result.content : [];
  const firstText = content.find((entry) => entry?.type === 'text')?.text || '';
  let parsedText = null;

  if (firstText) {
    try {
      parsedText = JSON.parse(firstText);
    } catch (_) {
      parsedText = firstText;
    }
  }

  return {
    ok: true,
    status: response.status,
    data: parsedText ?? result,
    error: null
  };
}

async function clawFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) };
  const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers||{}) } });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch(_) { return { ok: res.ok, status: res.status, data: text }; }
}

async function callBridgeTool(name, args = {}, id = 1) {
  try {
    const response = await clawFetch(`${BRIDGE_URL}/mcp`, {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: args }
      })
    });
    return normalizeToolResult(response, name);
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error.message };
  }
}

async function getClawStatus() {
  const [relay, bridge] = await Promise.all([
    clawFetch(`${RELAY_URL}/`).catch((error) => ({ ok: false, status: 0, data: null, error: error.message })),
    clawFetch(`${BRIDGE_URL}/health`).catch((error) => ({ ok: false, status: 0, data: null, error: error.message }))
  ]);

  return {
    relay: {
      url: RELAY_URL,
      reachable: relay.ok || relay.status === 404,
      status: relay.status,
      error: relay.ok ? null : relay.error || null
    },
    bridge: {
      url: BRIDGE_URL,
      reachable: bridge.ok || bridge.status === 400,
      status: bridge.status,
      error: bridge.ok ? null : bridge.error || null
    }
  };
}

router.get('/status', async (req, res) => {
  try {
    res.json(await getClawStatus());
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/overview', async (req, res) => {
  try {
    const [status, channels, agents] = await Promise.all([
      getClawStatus(),
      callBridgeTool('claw_channels_list', {}, 11),
      callBridgeTool('claw_agents_list', {}, 12)
    ]);
    res.json({
      status,
      channels,
      agents
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/channels', async (req, res) => {
  try {
    const response = await callBridgeTool('claw_channels_list', {}, 1);
    res.status(response.ok ? 200 : 502).json(response);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/message', async (req, res) => {
  const { channel, message } = req.body;
  if (!channel || !message) return res.status(400).json({ error: 'channel and message required' });
  try {
    const response = await callBridgeTool('claw_send_message', { channel_id: channel, message }, 2);
    res.status(response.ok ? 200 : 502).json(response);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agents', async (req, res) => {
  try {
    const response = await callBridgeTool('claw_agents_list', {}, 3);
    res.status(response.ok ? 200 : 502).json(response);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
