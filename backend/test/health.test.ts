import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestServer, type TestServer } from './helpers/server.js';

describe('API bootstrap', () => {
  let server: TestServer;
  let baseUrl = '';

  beforeAll(async () => {
    server = await startTestServer();
    baseUrl = server.baseUrl;
  });

  afterAll(async () => {
    await server.close();
  });

  it('responds 200 with status ok on /health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('responds structured JSON 404 for unknown routes', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
});
