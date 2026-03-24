import { describe, it, expect } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { IS_WINDOWS, SHELL_EXECUTABLE, SHELL_LABEL } from '../../services/host-runtime.js';
import { WORKSPACE_ROOT } from '../../services/local-agent.js';

// Build a minimal app that reproduces the /api/health endpoint
function createHealthApp() {
  const app = express();
  app.use(express.json());
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      version: '1.2.0',
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
        agents: true,
        database: !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)),
        rawSQL: !!(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL),
        openclaw: !!process.env.OPENCLAW_RELAY_URL,
        ops: true,
        compose: true
      }
    });
  });
  return supertest(app);
}

describe('GET /api/health', () => {
  const request = createHealthApp();

  it('returns 200', async () => {
    const res = await request.get('/api/health');
    expect(res.status).toBe(200);
  });

  it('returns status ok', async () => {
    const res = await request.get('/api/health');
    expect(res.body.status).toBe('ok');
  });

  it('returns version 1.2.0', async () => {
    const res = await request.get('/api/health');
    expect(res.body.version).toBe('1.2.0');
  });

  it('includes uptime as a number', async () => {
    const res = await request.get('/api/health');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('includes a valid ISO timestamp', async () => {
    const res = await request.get('/api/health');
    expect(() => new Date(res.body.timestamp)).not.toThrow();
    expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
  });

  it('includes workspaceRoot string', async () => {
    const res = await request.get('/api/health');
    expect(typeof res.body.workspaceRoot).toBe('string');
  });

  it('includes host object with platform, shell, shellExecutable, windows fields', async () => {
    const res = await request.get('/api/health');
    const { host } = res.body;
    expect(typeof host.platform).toBe('string');
    expect(typeof host.shell).toBe('string');
    expect(typeof host.shellExecutable).toBe('string');
    expect(typeof host.windows).toBe('boolean');
  });

  it('includes env object with expected boolean flags', async () => {
    const res = await request.get('/api/health');
    const { env } = res.body;
    expect(env.agents).toBe(true);
    expect(env.ops).toBe(true);
    expect(env.compose).toBe(true);
    expect(typeof env.database).toBe('boolean');
    expect(typeof env.rawSQL).toBe('boolean');
    expect(typeof env.openclaw).toBe('boolean');
  });
});
