// ── Session persistence service ───────────────────────────
// Saves agent conversation history to disk as JSON
// Each session is a file: sessions/SESSION_ID.json
//
// GET  /api/sessions              → list saved sessions
// GET  /api/sessions/:id          → load a session
// POST /api/sessions              → save { sessionId, agentId, messages }
// DELETE /api/sessions/:id        → delete session

import { Router } from 'express';
import { readdir, readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(__dirname, '..', 'sessions');

async function ensureDir() {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

router.get('/', async (req, res) => {
  await ensureDir();
  try {
    const files = await readdir(SESSIONS_DIR);
    const sessions = await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async f => {
          try {
            const raw = await readFile(join(SESSIONS_DIR, f), 'utf8');
            const data = JSON.parse(raw);
            return { id: f.replace('.json', ''), ...data, messageCount: data.messages?.length ?? 0 };
          } catch (_) { return null; }
        })
    );
    res.json(sessions.filter(Boolean).sort((a, b) => (b.updatedAt || '') > (a.updatedAt || '') ? 1 : -1));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  await ensureDir();
  try {
    const raw = await readFile(join(SESSIONS_DIR, `${req.params.id}.json`), 'utf8');
    res.json(JSON.parse(raw));
  } catch (_) {
    res.status(404).json({ error: 'Session not found' });
  }
});

router.post('/', async (req, res) => {
  await ensureDir();
  const { sessionId, agentId, messages, title } = req.body;
  if (!sessionId || !messages) return res.status(400).json({ error: 'sessionId and messages required' });
  const id = sessionId.replace(/[^a-z0-9_-]/gi, '_');
  const payload = {
    id, agentId: agentId || 'MIXED', title: title || `Session ${new Date().toLocaleDateString()}`,
    messages, createdAt: req.body.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(), messageCount: messages.length
  };
  await writeFile(join(SESSIONS_DIR, `${id}.json`), JSON.stringify(payload, null, 2), 'utf8');
  res.json({ success: true, id });
});

router.delete('/:id', async (req, res) => {
  await ensureDir();
  try {
    await unlink(join(SESSIONS_DIR, `${req.params.id}.json`));
    res.json({ success: true });
  } catch (_) {
    res.status(404).json({ error: 'Session not found' });
  }
});

export default router;
