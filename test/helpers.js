/**
 * Shared helper: wrap a router in a minimal Express app and return
 * a supertest agent. Avoids starting the real HTTP server.
 */
import express from 'express';
import supertest from 'supertest';

export function createTestApp(router, mountPath = '/') {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(mountPath, router);
  return supertest(app);
}
