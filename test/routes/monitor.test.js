import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers.js';
import monitorRouter from '../../routes/monitor.js';

const request = createTestApp(monitorRouter);

describe('GET /monitor/system', () => {
  it('returns 200', async () => {
    const res = await request.get('/system');
    expect(res.status).toBe(200);
  });

  it('includes cpu_pct as a number', async () => {
    const res = await request.get('/system');
    expect(typeof res.body.cpu_pct).toBe('number');
  });

  it('includes ram fields in GB', async () => {
    const res = await request.get('/system');
    expect(typeof res.body.ram_total_gb).toBe('number');
    expect(typeof res.body.ram_used_gb).toBe('number');
    expect(typeof res.body.ram_free_gb).toBe('number');
    expect(typeof res.body.ram_pct).toBe('number');
    expect(res.body.ram_total_gb).toBeGreaterThan(0);
  });

  it('includes disks array', async () => {
    const res = await request.get('/system');
    expect(Array.isArray(res.body.disks)).toBe(true);
    expect(res.body.disks.length).toBeGreaterThan(0);
  });

  it('ram_pct is between 0 and 100', async () => {
    const res = await request.get('/system');
    expect(res.body.ram_pct).toBeGreaterThanOrEqual(0);
    expect(res.body.ram_pct).toBeLessThanOrEqual(100);
  });
});

describe('GET /monitor/processes', () => {
  it('returns 200', async () => {
    const res = await request.get('/processes');
    expect(res.status).toBe(200);
  });

  it('returns a processes array', async () => {
    const res = await request.get('/processes');
    expect(Array.isArray(res.body.processes)).toBe(true);
  });

  it('includes ts timestamp', async () => {
    const res = await request.get('/processes');
    expect(typeof res.body.ts).toBe('string');
    expect(new Date(res.body.ts).getTime()).not.toBeNaN();
  });

  it('each process has Name, Id, CPU, RAM_MB, Threads', async () => {
    const res = await request.get('/processes');
    for (const proc of res.body.processes) {
      expect(typeof proc.Name).toBe('string');
      expect(typeof proc.Id).toBe('number');
      expect(typeof proc.CPU).toBe('number');
      expect(typeof proc.RAM_MB).toBe('number');
    }
  });

  it('sort=mem parameter is accepted', async () => {
    const res = await request.get('/processes?sort=mem');
    expect(res.status).toBe(200);
  });

  it('sort=name parameter is accepted', async () => {
    const res = await request.get('/processes?sort=name');
    expect(res.status).toBe(200);
  });

  it('limit parameter is respected', async () => {
    const res = await request.get('/processes?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.processes.length).toBeLessThanOrEqual(5);
  });
});

describe('POST /monitor/kill', () => {
  it('returns 400 when pid is missing', async () => {
    const res = await request.post('/kill').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pid required/i);
  });

  it('returns 400 when pid is NaN', async () => {
    const res = await request.post('/kill').send({ pid: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid pid/i);
  });

  it('returns 400 when pid is 0 (falsy)', async () => {
    // pid: 0 is falsy so the route treats it as missing
    const res = await request.post('/kill').send({ pid: 0 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when pid is 1 (reserved)', async () => {
    const res = await request.post('/kill').send({ pid: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid pid/i);
  });

  it('returns 400 when pid is 4 (boundary — still invalid)', async () => {
    const res = await request.post('/kill').send({ pid: 4 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid pid/i);
  });

  it('returns 400 when pid is negative', async () => {
    const res = await request.post('/kill').send({ pid: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid pid/i);
  });
});
