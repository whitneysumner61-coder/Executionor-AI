// ── Config route — read and write .env at runtime ─────────
// GET  /api/config          → returns config status (no secret values)
// POST /api/config          → { key, value } writes a key to .env
// POST /api/config/bulk     → { pairs: { KEY: VALUE, ... } }
// POST /api/config/restart  → graceful server restart

import { Router } from 'express';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', '.env');

// Keys we expose status for (never expose actual values)
const TRACKED_KEYS = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY', 'SUPABASE_DB_URL', 'OPENCLAW_RELAY_URL',
  'OPENCLAW_BRIDGE_URL', 'OPENCLAW_GATEWAY_TOKEN', 'PORT', 'DASHBOARD_TOKEN',
  'WORKSPACE_ROOT'
];

async function readEnv() {
  try {
    const raw = await readFile(ENV_PATH, 'utf8');
    const map = {};
    raw.split('\n').forEach(line => {
      const stripped = line.trim();
      if (!stripped || stripped.startsWith('#')) return;
      const eq = stripped.indexOf('=');
      if (eq === -1) return;
      map[stripped.slice(0, eq).trim()] = stripped.slice(eq + 1).trim();
    });
    return { raw, map };
  } catch (_) {
    return { raw: '', map: {} };
  }
}

async function writeEnvKey(key, value) {
  const { raw, map } = await readEnv();
  map[key] = value;

  // Rebuild .env preserving comments and order
  const lines = raw ? raw.split('\n') : [];
  let found = false;
  const updated = lines.map(line => {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#')) return line;
    const eq = stripped.indexOf('=');
    if (eq === -1) return line;
    const k = stripped.slice(0, eq).trim();
    if (k === key) { found = true; return `${key}=${value}`; }
    return line;
  });
  if (!found) updated.push(`${key}=${value}`);
  await writeFile(ENV_PATH, updated.join('\n'), 'utf8');
  // Hot-reload into current process
  process.env[key] = value;
}

router.get('/', async (req, res) => {
  const { map } = await readEnv();
  const status = {};
  for (const key of TRACKED_KEYS) {
    const val = map[key] || process.env[key] || '';
    const filled = val !== '' &&
      !val.startsWith('sk-ant-...') &&
      !val.startsWith('eyJ...') &&
      !val.includes('your-project') &&
      val !== 'executionor-local';
    status[key] = { configured: filled, length: val.length };
  }
  res.json({
    status,
    ready: {
      agents:   true,
      database: !!(map.SUPABASE_URL || process.env.SUPABASE_URL),
      openclaw: !!(map.OPENCLAW_RELAY_URL),
    }
  });
});

router.post('/', async (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' });
  if (!TRACKED_KEYS.includes(key)) return res.status(400).json({ error: `Unknown key: ${key}` });
  try {
    await writeEnvKey(key, value);
    res.json({ success: true, key, note: 'Written to .env and hot-loaded into process' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bulk', async (req, res) => {
  const { pairs } = req.body;
  if (!pairs || typeof pairs !== 'object') return res.status(400).json({ error: 'pairs object required' });
  const results = {};
  for (const [key, value] of Object.entries(pairs)) {
    if (!TRACKED_KEYS.includes(key)) { results[key] = 'skipped (unknown key)'; continue; }
    try { await writeEnvKey(key, value); results[key] = 'ok'; }
    catch (err) { results[key] = `error: ${err.message}`; }
  }
  res.json({ results });
});

export default router;
