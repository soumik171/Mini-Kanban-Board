import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { refreshCookieFrom, startTestServer, type TestServer } from './helpers/server.js';

let server: TestServer;
let baseUrl = '';

const password = 'supersecret1';

interface AuthedUser {
  id: string;
  email: string;
  name: string;
  bearer: string;
}

async function createUser(label: string): Promise<AuthedUser> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

  const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, name: label, password }),
  });
  expect(registerRes.status).toBe(201);

  const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `refreshToken=${refreshCookieFrom(registerRes)}`,
    },
  });
  expect(refreshRes.status).toBe(200);
  const refreshBody = (await refreshRes.json()) as { accessToken: string };

  const registerBody = (await registerRes.json()) as { user: { id: string; email: string; name: string } };
  return {
    id: registerBody.user.id,
    email: registerBody.user.email,
    name: registerBody.user.name,
    bearer: refreshBody.accessToken,
  };
}

async function api(
  method: string,
  path: string,
  opts: { bearer?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.bearer) {
    headers.authorization = `Bearer ${opts.bearer}`;
  }
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function createBoard(owner: AuthedUser, title = 'My Board'): Promise<{ id: string }> {
  const res = await api('POST', '/api/boards', {
    bearer: owner.bearer,
    body: { title },
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { board: { id: string } };
  return body.board;
}

beforeAll(async () => {
  server = await startTestServer();
  baseUrl = server.baseUrl;
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

describe('boards & sharing', () => {
  it('creates a board owned by the caller and surfaces it with role OWNER', async () => {
    const owner = await createUser('owner');

    const res = await api('POST', '/api/boards', {
      bearer: owner.bearer,
      body: { title: 'Launch Plan', description: 'Phase 6 scope' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      board: { id: string; title: string; owner: { email: string } };
    };
    expect(body.board.owner.email).toBe(owner.email);

    const detail = await api('GET', `/api/boards/${body.board.id}`, { bearer: owner.bearer });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { role: string };
    expect(detailBody.role).toBe('OWNER');

    const list = await api('GET', '/api/boards', { bearer: owner.bearer });
    const listBody = (await list.json()) as { boards: { title: string; role: string }[] };
    expect(listBody.boards).toContainEqual(expect.objectContaining({ title: 'Launch Plan', role: 'OWNER' }));
  });

  it('requires authentication for every board route', async () => {
    const res = await api('POST', '/api/boards', { body: { title: 'Nope' } });
    expect(res.status).toBe(401);

    const detail = await api('GET', '/api/boards/some-board');
    expect(detail.status).toBe(401);
  });

  it('hides boards from non-members and 403s on direct access', async () => {
    const owner = await createUser('hidden-owner');
    const stranger = await createUser('stranger');
    const board = await createBoard(owner);

    const detail = await api('GET', `/api/boards/${board.id}`, { bearer: stranger.bearer });
    expect(detail.status).toBe(403);
    const detailBody = (await detail.json()) as { error: { code: string } };
    expect(detailBody.error.code).toBe('FORBIDDEN');

    const list = await api('GET', '/api/boards', { bearer: stranger.bearer });
    const listBody = (await list.json()) as { boards: { id: string }[] };
    expect(listBody.boards).not.toContainEqual(expect.objectContaining({ id: board.id }));
  });

  it('returns 404 BOARD_NOT_FOUND for unknown boards', async () => {
    const user = await createUser('missing-board');
    const res = await api('GET', '/api/boards/does-not-exist', { bearer: user.bearer });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BOARD_NOT_FOUND');
  });

  it('lets the owner share a board with a member by email and lists both roles', async () => {
    const owner = await createUser('share-owner');
    const member = await createUser('share-member');
    const board = await createBoard(owner);

    const share = await api('POST', `/api/boards/${board.id}/members`, {
      bearer: owner.bearer,
      body: { email: member.email, role: 'VIEWER' },
    });
    expect(share.status).toBe(201);
    const shareBody = (await share.json()) as { member: { user: { email: string }; role: string } };
    expect(shareBody.member).toEqual({ user: expect.objectContaining({ email: member.email }), role: 'VIEWER' });

    const members = await api('GET', `/api/boards/${board.id}/members`, { bearer: owner.bearer });
    const membersBody = (await members.json()) as {
      members: { user: { email: string }; role: string }[];
    };
    expect(membersBody.members).toHaveLength(2);
    expect(membersBody.members).toContainEqual(
      expect.objectContaining({ user: expect.objectContaining({ email: owner.email }), role: 'OWNER' }),
    );
    expect(membersBody.members).toContainEqual(
      expect.objectContaining({ user: expect.objectContaining({ email: member.email }), role: 'VIEWER' }),
    );
  });

  it('grants a VIEWER read access but denies member management', async () => {
    const owner = await createUser('viewer-owner');
    const viewer = await createUser('viewer-user');
    const other = await createUser('viewer-target');
    const board = await createBoard(owner);

    await api('POST', `/api/boards/${board.id}/members`, {
      bearer: owner.bearer,
      body: { email: viewer.email, role: 'VIEWER' },
    });

    const detail = await api('GET', `/api/boards/${board.id}`, { bearer: viewer.bearer });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { role: string };
    expect(detailBody.role).toBe('VIEWER');

    const add = await api('POST', `/api/boards/${board.id}/members`, {
      bearer: viewer.bearer,
      body: { email: other.email, role: 'VIEWER' },
    });
    expect(add.status).toBe(403);

    const remove = await api('DELETE', `/api/boards/${board.id}/members/${other.id}`, {
      bearer: viewer.bearer,
    });
    expect(remove.status).toBe(403);
  });

  it('lets the owner change a member role and the member reflects it', async () => {
    const owner = await createUser('role-owner');
    const member = await createUser('role-member');
    const board = await createBoard(owner);

    await api('POST', `/api/boards/${board.id}/members`, {
      bearer: owner.bearer,
      body: { email: member.email, role: 'VIEWER' },
    });

    const change = await api('PATCH', `/api/boards/${board.id}/members/${member.id}`, {
      bearer: owner.bearer,
      body: { role: 'EDITOR' },
    });
    expect(change.status).toBe(200);
    const changeBody = (await change.json()) as { member: { role: string } };
    expect(changeBody.member.role).toBe('EDITOR');

    const detail = await api('GET', `/api/boards/${board.id}`, { bearer: member.bearer });
    const detailBody = (await detail.json()) as { role: string };
    expect(detailBody.role).toBe('EDITOR');
  });

  it('removes a member and revokes their access', async () => {
    const owner = await createUser('remove-owner');
    const member = await createUser('remove-member');
    const board = await createBoard(owner);

    await api('POST', `/api/boards/${board.id}/members`, {
      bearer: owner.bearer,
      body: { email: member.email, role: 'EDITOR' },
    });

    const remove = await api('DELETE', `/api/boards/${board.id}/members/${member.id}`, {
      bearer: owner.bearer,
    });
    expect(remove.status).toBe(204);

    const detail = await api('GET', `/api/boards/${board.id}`, { bearer: member.bearer });
    expect(detail.status).toBe(403);
  });

  it('rejects invalid sharing targets and duplicate memberships', async () => {
    const owner = await createUser('guard-owner');
    const member = await createUser('guard-member');
    const outsider = await createUser('guard-outside');
    const board = await createBoard(owner);

    const missing = await api('POST', `/api/boards/${board.id}/members`, {
      bearer: owner.bearer,
      body: { email: 'ghost@example.test', role: 'VIEWER' },
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('USER_NOT_FOUND');

    const duplicate = await api('POST', `/api/boards/${board.id}/members`, {
      bearer: owner.bearer,
      body: { email: member.email, role: 'EDITOR' },
    });
    expect(duplicate.status).toBe(201);
    const again = await api('POST', `/api/boards/${board.id}/members`, {
      bearer: owner.bearer,
      body: { email: member.email, role: 'VIEWER' },
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('ALREADY_MEMBER');

    const ownerEmail = await api('POST', `/api/boards/${board.id}/members`, {
      bearer: owner.bearer,
      body: { email: owner.email, role: 'VIEWER' },
    });
    expect(ownerEmail.status).toBe(409);

    const badRole = await api('POST', `/api/boards/${board.id}/members`, {
      bearer: owner.bearer,
      body: { email: member.email, role: 'OWNER' },
    });
    expect(badRole.status).toBe(400);

    const notMember = await api('PATCH', `/api/boards/${board.id}/members/${outsider.id}`, {
      bearer: owner.bearer,
      body: { role: 'VIEWER' },
    });
    expect(notMember.status).toBe(404);

    const ownerRemove = await api('DELETE', `/api/boards/${board.id}/members/${owner.id}`, {
      bearer: owner.bearer,
    });
    expect(ownerRemove.status).toBe(400);
    expect(((await ownerRemove.json()) as { error: { code: string } }).error.code).toBe(
      'CANNOT_REMOVE_OWNER',
    );
  });
});

describe('authorization', () => {
  it('lets an EDITOR read a board but never manage membership', async () => {
    const owner = await createUser('authz-owner');
    const editor = await createUser('authz-editor');
    const outsider = await createUser('authz-outside');
    const board = await createBoard(owner);

    await api('POST', `/api/boards/${board.id}/members`, {
      bearer: owner.bearer,
      body: { email: editor.email, role: 'EDITOR' },
    });

    const detail = await api('GET', `/api/boards/${board.id}`, { bearer: editor.bearer });
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { role: string }).role).toBe('EDITOR');

    const members = await api('GET', `/api/boards/${board.id}/members`, { bearer: editor.bearer });
    expect(members.status).toBe(200);

    const add = await api('POST', `/api/boards/${board.id}/members`, {
      bearer: editor.bearer,
      body: { email: outsider.email, role: 'VIEWER' },
    });
    expect(add.status).toBe(403);

    const change = await api('PATCH', `/api/boards/${board.id}/members/${outsider.id}`, {
      bearer: editor.bearer,
      body: { role: 'EDITOR' },
    });
    expect(change.status).toBe(403);

    const remove = await api('DELETE', `/api/boards/${board.id}/members/${outsider.id}`, {
      bearer: editor.bearer,
    });
    expect(remove.status).toBe(403);
  });

  it('hides the member list from non-members', async () => {
    const owner = await createUser('authz-list-owner');
    const stranger = await createUser('authz-list-stranger');
    const board = await createBoard(owner);

    const members = await api('GET', `/api/boards/${board.id}/members`, { bearer: stranger.bearer });
    expect(members.status).toBe(403);
  });

  it('rejects attempts to escalate a member to OWNER', async () => {
    const owner = await createUser('authz-escalate-owner');
    const member = await createUser('authz-escalate-member');
    const board = await createBoard(owner);

    await api('POST', `/api/boards/${board.id}/members`, {
      bearer: owner.bearer,
      body: { email: member.email, role: 'VIEWER' },
    });

    const escalate = await api('PATCH', `/api/boards/${board.id}/members/${member.id}`, {
      bearer: owner.bearer,
      body: { role: 'OWNER' },
    });
    expect(escalate.status).toBe(400);
    expect(((await escalate.json()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });
});
