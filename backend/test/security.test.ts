import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { refreshCookieFrom, startTestServer, type TestServer } from './helpers/server.js';

let server: TestServer;
let baseUrl = '';

const password = 'supersecret1';

beforeAll(async () => {
  server = await startTestServer();
  baseUrl = server.baseUrl;
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

describe('security hardening', () => {
  it('serves security headers and hides the framework fingerprint', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('allows only the configured client origin to read credentialed responses', async () => {
    const allowed = await fetch(`${baseUrl}/health`, {
      headers: { origin: 'http://localhost:3000' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(allowed.headers.get('access-control-allow-credentials')).toBe('true');

    const denied = await fetch(`${baseUrl}/health`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects malformed JSON with 400 INVALID_JSON', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"email":',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_JSON');
  });

  it('rejects bodies over the 100kb limit with 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'oversized@example.test',
        name: 'x'.repeat(200_000),
        password,
      }),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rate-limits auth endpoints and answers RATE_LIMITED after the cap', async () => {
    // A dedicated server so burning the 100-token budget doesn't 429 the
    // other tests in this file (limiters are per app instance).
    const isolated = await startTestServer();
    try {
      const badLogin = (i: number): Promise<Response> =>
        fetch(`${isolated.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: `probe-${i}@example.test`, password: 'wrong-password-1' }),
        });

      // First probe passes (bad credentials -> 401) and advertises the cap.
      // Draft-7 standard headers use a single RateLimit header, e.g.
      // `RateLimit: limit=100, remaining=99, reset=...`.
      const first = await badLogin(0);
      expect(first.status).toBe(401);
      expect(first.headers.get('ratelimit')).toContain('limit=100');

      // 100 more probes cross the cap; the final one must be throttled.
      let last: Response | undefined;
      for (let i = 1; i <= 100; i++) {
        last = await badLogin(i);
      }
      expect(last?.status).toBe(429);
      const body = (await last?.json()) as { error: { code: string } };
      expect(body.error.code).toBe('RATE_LIMITED');
    } finally {
      await isolated.close();
    }
  });

  it('sets an HttpOnly, SameSite=Lax refresh cookie scoped to /api/auth', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `flags-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
        name: 'Cookie Flags',
        password,
      }),
    });
    expect(res.status).toBe(201);

    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    const rows = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    const row = rows.find((r) => r.startsWith('refreshToken='));
    expect(row).toBeDefined();
    expect(row).toContain('HttpOnly');
    expect(row).toContain('SameSite=Lax');
    expect(row).toContain('Path=/api/auth');
  });

  it('rejects tampered or cross-type tokens with 401 UNAUTHORIZED', async () => {
    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: 'Bearer not-a-jwt' },
    });
    expect(me.status).toBe(401);
    expect(((await me.json()) as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');

    // A refresh token must never be accepted as an access token.
    const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `cross-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
        name: 'Cross Type',
        password,
      }),
    });
    const cookie = refreshCookieFrom(registerRes);
    const meWithRefresh = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${cookie}` },
    });
    expect(meWithRefresh.status).toBe(401);
  });

  it('never leaks password hashes in responses', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `leak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
        name: 'Leak Check',
        password,
      }),
    });
    expect(res.status).toBe(201);
    expect(JSON.stringify(await res.json())).not.toMatch(/password|hash/i);
  });
});