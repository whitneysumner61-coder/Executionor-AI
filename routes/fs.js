// ── Filesystem route v2 ───────────────────────────────────
// GET    /api/fs/list?path=D:\tools
// GET    /api/fs/read?path=D:\tools\file.ps1
// POST   /api/fs/write   { path, content }
// POST   /api/fs/mkdir   { path }
// POST   /api/fs/rename  { path, newName }
// DELETE /api/fs?path=...
// GET    /api/fs/search?path=D:\tools&query=mcp&ext=js
// GET    /api/fs/exists?path=...

import { Router } from 'express';
import { readdir, readFile, writeFile, stat, unlink, rmdir, rename, mkdir } from 'fs/promises';
import { join, extname, basename, dirname } from 'path';

const router = Router();

// ── List directory ────────────────────────────────────────
router.get('/list', async (req, res) => {
  const dirPath = req.query.path || 'D:\\tools';
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const items = await Promise.all(entries.map(async entry => {
      const fullPath = join(dirPath, entry.name);
      const ext = extname(entry.name).toLowerCase().slice(1);
      let size = '—', bytes = 0;
      try {
        const s = await stat(fullPath);
        bytes = s.size;
        if (!entry.isDirectory()) {
          size = s.size < 1024 ? `${s.size}b`
               : s.size < 1048576 ? `${(s.size/1024).toFixed(1)}kb`
               : `${(s.size/1048576).toFixed(1)}mb`;
        }
      } catch(_) {}
      return { name: entry.name, type: entry.isDirectory() ? 'dir' : 'file', ext, size, bytes, path: fullPath };
    }));
    items.sort((a,b) => a.type !== b.type ? (a.type==='dir'?-1:1) : a.name.localeCompare(b.name));
    res.json({ path: dirPath, items });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Read file ─────────────────────────────────────────────
router.get('/read', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    const content = await readFile(filePath, 'utf8');
    const ext = extname(filePath).toLowerCase().slice(1);
    res.json({ path: filePath, name: basename(filePath), content, ext, bytes: Buffer.byteLength(content) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Write file ────────────────────────────────────────────
router.post('/write', async (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined) return res.status(400).json({ error: 'path and content required' });
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
    res.json({ success: true, path: filePath, bytes: Buffer.byteLength(content, 'utf8') });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Make directory ────────────────────────────────────────
router.post('/mkdir', async (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) return res.status(400).json({ error: 'path required' });
  try {
    await mkdir(dirPath, { recursive: true });
    res.json({ success: true, path: dirPath });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Rename / move ─────────────────────────────────────────
router.post('/rename', async (req, res) => {
  const { path: oldPath, newName } = req.body;
  if (!oldPath || !newName) return res.status(400).json({ error: 'path and newName required' });
  const newPath = join(dirname(oldPath), newName);
  try {
    await rename(oldPath, newPath);
    res.json({ success: true, oldPath, newPath });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Delete ────────────────────────────────────────────────
router.delete('/', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) await rmdir(filePath, { recursive: true });
    else await unlink(filePath);
    res.json({ success: true, path: filePath });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Search files ──────────────────────────────────────────
router.get('/search', async (req, res) => {
  const { path: searchPath = 'D:\\tools', query = '', ext = '' } = req.query;
  if (!query.trim()) return res.status(400).json({ error: 'query required' });

  const results = [];
  const qLower  = query.toLowerCase();
  const extFilter = ext ? ext.toLowerCase().split(',').map(e => e.trim().replace(/^\./,'')) : [];

  async function walk(dir, depth = 0) {
    if (depth > 4 || results.length > 100) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch(_) { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else {
        const fileExt = extname(e.name).slice(1).toLowerCase();
        if (extFilter.length && !extFilter.includes(fileExt)) continue;
        if (e.name.toLowerCase().includes(qLower)) {
          results.push({ name: e.name, path: full, ext: fileExt, matchType: 'name' });
        }
      }
    }
  }

  await walk(searchPath);
  res.json({ query, results: results.slice(0, 50) });
});

// ── Exists ────────────────────────────────────────────────
router.get('/exists', async (req, res) => {
  try { await stat(req.query.path); res.json({ exists: true }); }
  catch(_) { res.json({ exists: false }); }
});

export default router;
