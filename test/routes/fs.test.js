import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers.js';
import fsRouter from '../../routes/fs.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, rm } from 'fs/promises';

const request = createTestApp(fsRouter);
const TMP = tmpdir();

describe('GET /fs/read', () => {
  it('returns 400 when path is missing', async () => {
    const res = await request.get('/read');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path required/i);
  });

  it('returns 500 for a non-existent file path', async () => {
    const res = await request.get('/read?path=/nonexistent/path/xyz.txt');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  it('reads an existing file and returns content', async () => {
    const filePath = join(TMP, `vitest_read_${Date.now()}.txt`);
    await writeFile(filePath, 'hello vitest', 'utf8');
    try {
      const res = await request.get(`/read?path=${encodeURIComponent(filePath)}`);
      expect(res.status).toBe(200);
      expect(res.body.content).toBe('hello vitest');
      expect(res.body.path).toBe(filePath);
      expect(typeof res.body.bytes).toBe('number');
    } finally {
      await rm(filePath, { force: true });
    }
  });
});

describe('GET /fs/list', () => {
  it('returns 200 for a valid directory', async () => {
    const res = await request.get(`/list?path=${encodeURIComponent(TMP)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.path).toBe(TMP);
  });

  it('each item has name, type, path, ext fields', async () => {
    const res = await request.get(`/list?path=${encodeURIComponent(TMP)}`);
    for (const item of res.body.items.slice(0, 5)) {
      expect(typeof item.name).toBe('string');
      expect(['file', 'dir']).toContain(item.type);
      expect(typeof item.path).toBe('string');
    }
  });

  it('directories appear before files in the listing', async () => {
    const res = await request.get(`/list?path=${encodeURIComponent(TMP)}`);
    const types = res.body.items.map((i) => i.type);
    // If there are both dirs and files, dirs should come first
    const lastDir = types.lastIndexOf('dir');
    const firstFile = types.indexOf('file');
    if (lastDir !== -1 && firstFile !== -1) {
      expect(lastDir).toBeLessThan(firstFile);
    }
  });

  it('returns 500 for a non-existent directory', async () => {
    const res = await request.get('/list?path=/nonexistent/directory/xyz');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /fs/write', () => {
  it('returns 400 when path is missing', async () => {
    const res = await request.post('/write').send({ content: 'some content' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/path.*content required/i);
  });

  it('returns 400 when content is undefined', async () => {
    const res = await request.post('/write').send({ path: '/tmp/test.txt' });
    expect(res.status).toBe(400);
  });

  it('writes a file and returns success', async () => {
    const filePath = join(TMP, `vitest_write_${Date.now()}.txt`);
    try {
      const res = await request.post('/write').send({ path: filePath, content: 'written by vitest' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.path).toBe(filePath);
      expect(typeof res.body.bytes).toBe('number');
    } finally {
      await rm(filePath, { force: true });
    }
  });

  it('accepts empty string content', async () => {
    const filePath = join(TMP, `vitest_empty_${Date.now()}.txt`);
    try {
      const res = await request.post('/write').send({ path: filePath, content: '' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    } finally {
      await rm(filePath, { force: true });
    }
  });
});

describe('GET /fs/exists', () => {
  it('returns true for an existing path', async () => {
    const res = await request.get(`/exists?path=${encodeURIComponent(TMP)}`);
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
  });

  it('returns false for a non-existing path', async () => {
    const res = await request.get('/exists?path=/this/path/does/not/exist/xyz');
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
  });
});
