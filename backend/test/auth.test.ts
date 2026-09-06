import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { refreshCookieFrom, startTestServer, type TestServer } from './helpers/server.js';

let server: TestServer;
let baseUrl = '';

const email = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
const password = 'supersecret1';
const name = 'Test User';

beforeAll(async () => {
  server = await startTestServer();
  baseUrl = server.baseUrl;
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function registerUser(userEmail = email): Promise<{ res: Response; cookie: string }> {
  const res = await postJson('/api/auth/register', {
    email: userEmail,
    name,
    password,
  });
  return { res, cookie: refreshCookieFrom(res) };
}

async function login(): Promise<{ res: Response; cookie: string }> {
  const res = await postJson('/api/auth/login', { email, password });
  return { res, cookie: refreshCookieFrom(res) };
}

describe('authentication', () => {
  it('registers a user, returns the public profile, and sets a refresh cookie', async () => {
    const { res, cookie } = await registerUser();
    expect(res.status).toBe(201);

    const body = (await res.json()) as { user: { id: string; email: string; name: string } };
    expect(body.user).toEqual({ id: expect.any(String), email, name });
    expect(cookie.length).toBeGreaterThan(0);
  });

  it('rejects a duplicate email with 400 EMAIL_IN_USE', async () => {
    const res = await postJson('/api/auth/register', {
      email,
      name,
      password,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('EMAIL_IN_USE');
  });

  it('logs in with correct credentials', async () => {
    const { res, cookie } = await login();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string } };
    expect(body.user.email).toBe(email);
    expect(cookie.length).toBeGreaterThan(0);
  });

  it('rejects wrong credentials with 401 INVALID_CREDENTIALS', async () => {
    const res = await postJson('/api/auth/login', { email, password: 'wrong-password-1' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rotates the refresh token and authenticates /me with the access token', async () => {
    const { cookie } = await login();

    const refreshRes = await postJson('/api/auth/refresh', {}, { cookie: `refreshToken=${cookie}` });
    expect(refreshRes.status).toBe(200);
    const refreshBody = (await refreshRes.json()) as { accessToken: string };
    expect(typeof refreshBody.accessToken).toBe('string');
    expect(refreshCookieFrom(refreshRes).length).toBeGreaterThan(0);

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${refreshBody.accessToken}` },
    });
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as { user: { email: string } };
    expect(meBody.user.email).toBe(email);
  });

  it('logs out: clears the refresh cookie (stateless ceiling documented in the plan)', async () => {
    const { cookie } = await login();

    const logoutRes = await postJson('/api/auth/logout', {}, { cookie: `refreshToken=${cookie}` });
    expect(logoutRes.status).toBe(204);
    // The cookie value is emptied and expired on the client; server-side the token
    // remains valid until expiry by design (stateless refresh rotation).
    expect(refreshCookieFrom(logoutRes)).toBe('');
  });

  it('rejects requests without a valid access token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
