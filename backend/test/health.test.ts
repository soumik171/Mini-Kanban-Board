import type { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

describe('API bootstrap', () => {
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = buildApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server did not bind a port');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('responds 200 with status ok on /health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('responds JSON 404 for unknown routes', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
