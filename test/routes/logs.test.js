import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers.js';
import logsRouter from '../../routes/logs.js';

const request = createTestApp(logsRouter);

describe('GET /logs/files', () => {
  it('returns 200', async () => {
    const res = await request.get('/files');
    expect(res.status).toBe(200);
  });

  it('returns an array of existing log files', async () => {
    const res = await request.get('/files');
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('each file entry has name, path, exists, size, mtime', async () => {
    const res = await request.get('/files');
    for (const f of res.body) {
      expect(typeof f.name).toBe('string');
      expect(typeof f.path).toBe('string');
      expect(f.exists).toBe(true); // The route filters to only existing files
      expect(typeof f.size).toBe('number');
    }
  });
});
