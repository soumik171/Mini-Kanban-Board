import type { Server } from 'node:http';

import { buildApp } from '../../src/app.js';

export interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const app = buildApp();
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server did not bind a port');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export function refreshCookieFrom(res: Response): string {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const rows = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const row = rows.find((r) => r.startsWith('refreshToken='));
  if (!row) {
    throw new Error('Response did not set a refreshToken cookie');
  }
  return row.split(';')[0]?.split('=').slice(1).join('=') ?? '';
}
