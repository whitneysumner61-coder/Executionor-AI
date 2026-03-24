// ── WebSocket connection manager ─────────────────────────
// Holds all active WS clients and provides broadcast utilities
const clients = new Set();

export function attachWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    clients.add(ws);
    console.log(`[WS] Client connected (total: ${clients.size})`);

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
      clients.delete(ws);
    });

    // Send initial handshake
    safeSend(ws, { type: 'connected', message: 'EXECUTIONOR WebSocket ready' });
  });
}

export function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

export function safeSend(ws, payload) {
  try {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  } catch (_) {}
}
