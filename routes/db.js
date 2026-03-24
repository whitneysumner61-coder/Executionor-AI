// ── Supabase DB route v2 ──────────────────────────────────
// POST /api/db/select  { table|sql, filters?, limit?, orderBy?, orderDir? }
// POST /api/db/query   { sql }   ← raw, needs SUPABASE_DB_URL
// POST /api/db/insert  { table, rows: [...] }
// POST /api/db/update  { table, id, data }
// POST /api/db/delete  { table, id }
// POST /api/db/upsert  { table, rows: [...], onConflict }
// GET  /api/db/tables
// GET  /api/db/schema?table=name

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY not set in .env — use ⚙ Settings to configure');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function runRawSQL(sql) {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('SUPABASE_DB_URL not set — add it in ⚙ Settings for raw SQL support');
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query(sql);
    return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length,
             fields: result.fields?.map(f => ({ name: f.name })) ?? [] };
  } finally { await client.end(); }
}

function parseSelectParams(sql) {
  if (!sql) return null;
  const s = sql.trim().replace(/\s+/g, ' ');
  const tableMatch = s.match(/\bFROM\s+["'`]?(\w+)["'`]?/i);
  if (!tableMatch) return null;
  const table   = tableMatch[1];
  const limit   = parseInt(s.match(/\bLIMIT\s+(\d+)/i)?.[1]) || 100;
  const orderM  = s.match(/\bORDER BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
  const orderBy = orderM ? orderM[1] : null;
  const orderDir = orderM?.[2]?.toUpperCase() === 'DESC' ? 'desc' : 'asc';
  const filters  = {};
  const whereM = s.match(/\bWHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/i);
  if (whereM) {
    whereM[1].split(/\s+AND\s+/i).forEach(cond => {
      const m = cond.match(/(\w+)\s*=\s*'?([^']+)'?/);
      if (m) filters[m[1]] = m[2];
    });
  }
  return { table, limit, orderBy, orderDir, filters };
}

async function execSelect({ table, filters, limit = 100, orderBy, orderDir = 'asc' }, start, res, strategy) {
  try {
    const supabase = getClient();
    let q = supabase.from(table).select('*', { count: 'exact' }).limit(parseInt(limit) || 100);
    if (orderBy) q = q.order(orderBy, { ascending: orderDir !== 'desc' });
    if (filters) for (const [col, val] of Object.entries(filters)) { if (val != null) q = q.eq(col, val); }
    const { data, error, count } = await q;
    if (error) return res.status(400).json({ error: error.message, code: error.code });
    res.json({ rows: data, rowCount: count ?? data?.length, duration: `${Date.now()-start}ms`, strategy });
  } catch(err) { res.status(500).json({ error: err.message }); }
}

// ── SELECT ────────────────────────────────────────────────
router.post('/select', async (req, res) => {
  const { table, sql } = req.body;
  const start = Date.now();
  if (sql && !table) {
    const parsed = parseSelectParams(sql);
    if (parsed) return execSelect(parsed, start, res, 'supabase-parsed');
    try {
      const r = await runRawSQL(sql);
      return res.json({ ...r, duration: `${Date.now()-start}ms`, strategy: 'pg' });
    } catch(e) { return res.status(400).json({ error: e.message }); }
  }
  if (!table) return res.status(400).json({ error: 'table or sql required' });
  return execSelect(req.body, start, res, 'supabase-direct');
});

// ── RAW QUERY ─────────────────────────────────────────────
router.post('/query', async (req, res) => {
  const { sql } = req.body;
  if (!sql?.trim()) return res.status(400).json({ error: 'sql required' });
  const start = Date.now();
  try {
    const r = await runRawSQL(sql);
    res.json({ ...r, duration: `${Date.now()-start}ms`, strategy: 'pg' });
  } catch(err) {
    const parsed = parseSelectParams(sql);
    if (parsed) return execSelect(parsed, start, res, 'supabase-fallback');
    res.status(500).json({ error: err.message, hint: 'Add SUPABASE_DB_URL to .env for raw SQL' });
  }
});

// ── INSERT ────────────────────────────────────────────────
router.post('/insert', async (req, res) => {
  const { table, rows } = req.body;
  if (!table || !rows) return res.status(400).json({ error: 'table and rows required' });
  const start = Date.now();
  try {
    const supabase = getClient();
    const payload = Array.isArray(rows) ? rows : [rows];
    const { data, error } = await supabase.from(table).insert(payload).select();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ rows: data, rowCount: data?.length, duration: `${Date.now()-start}ms` });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── UPDATE ────────────────────────────────────────────────
router.post('/update', async (req, res) => {
  const { table, id, idColumn = 'id', data: updateData } = req.body;
  if (!table || !id || !updateData) return res.status(400).json({ error: 'table, id, and data required' });
  const start = Date.now();
  try {
    const supabase = getClient();
    const { data, error } = await supabase.from(table).update(updateData).eq(idColumn, id).select();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ rows: data, rowCount: data?.length, duration: `${Date.now()-start}ms` });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE ────────────────────────────────────────────────
router.post('/delete', async (req, res) => {
  const { table, id, idColumn = 'id' } = req.body;
  if (!table || !id) return res.status(400).json({ error: 'table and id required' });
  const start = Date.now();
  try {
    const supabase = getClient();
    const { data, error } = await supabase.from(table).delete().eq(idColumn, id).select();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ deleted: data?.length ?? 1, duration: `${Date.now()-start}ms` });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── UPSERT ────────────────────────────────────────────────
router.post('/upsert', async (req, res) => {
  const { table, rows, onConflict = 'id' } = req.body;
  if (!table || !rows) return res.status(400).json({ error: 'table and rows required' });
  const start = Date.now();
  try {
    const supabase = getClient();
    const { data, error } = await supabase.from(table).upsert(Array.isArray(rows)?rows:[rows], { onConflict }).select();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ rows: data, rowCount: data?.length, duration: `${Date.now()-start}ms` });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── LIST TABLES ───────────────────────────────────────────
router.get('/tables', async (req, res) => {
  try {
    const r = await runRawSQL(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
    return res.json({ tables: r.rows.map(x => x.table_name), source: 'pg' });
  } catch(_) {}
  res.json({ tables: ['properties','contacts','transactions','mhp_lots','notes'], source: 'static' });
});

// ── SCHEMA ────────────────────────────────────────────────
router.get('/schema', async (req, res) => {
  const { table } = req.query;
  if (!table) return res.status(400).json({ error: 'table required' });
  try {
    const r = await runRawSQL(`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='${table.replace(/'/g,"''")}' ORDER BY ordinal_position`);
    return res.json({ table, columns: r.rows, source: 'pg' });
  } catch(_) {}
  try {
    const sb = getClient();
    const { data, error } = await sb.from(table).select('*').limit(1);
    if (!error && data?.length) return res.json({ table, columns: Object.keys(data[0]).map(c=>({column_name:c,data_type:typeof data[0][c]})), source:'inferred' });
  } catch(_) {}
  res.status(404).json({ error: `Cannot fetch schema for ${table}` });
});

export default router;
