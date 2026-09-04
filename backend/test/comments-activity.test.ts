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

async function createBoard(owner: AuthedUser, title = 'Feed Board'): Promise<{ id: string }> {
  const res = await api('POST', '/api/boards', {
    bearer: owner.bearer,
    body: { title },
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { board: { id: string } };
  return body.board;
}

async function share(boardId: string, owner: AuthedUser, member: AuthedUser, role: string): Promise<void> {
  const res = await api('POST', `/api/boards/${boardId}/members`, {
    bearer: owner.bearer,
    body: { email: member.email, role },
  });
  expect(res.status).toBe(201);
}

async function createColumn(bearer: string, boardId: string, title: string): Promise<{ id: string }> {
  const res = await api('POST', `/api/boards/${boardId}/columns`, { bearer, body: { title } });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { column: { id: string } };
  return body.column;
}

async function createTask(
  bearer: string,
  boardId: string,
  columnId: string,
  title: string,
): Promise<{ id: string }> {
  const res = await api('POST', `/api/boards/${boardId}/columns/${columnId}/tasks`, {
    bearer,
    body: { title },
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { task: { id: string } };
  return body.task;
}

async function addComment(
  bearer: string,
  boardId: string,
  taskId: string,
  content: string,
): Promise<{ id: string }> {
  const res = await api('POST', `/api/boards/${boardId}/tasks/${taskId}/comments`, {
    bearer,
    body: { content },
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { comment: { id: string } };
  return body.comment;
}

interface ActivityEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  actor: { id: string; email: string; name: string };
  metadata: Record<string, unknown> | null;
}

async function getActivity(boardId: string, bearer: string, query = ''): Promise<Response> {
  return api('GET', `/api/boards/${boardId}/activity${query}`, { bearer });
}

beforeAll(async () => {
  server = await startTestServer();
  baseUrl = server.baseUrl;
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

describe('task comments', () => {
  it('adds, lists, and deletes comments with author info and audit trail', async () => {
    const owner = await createUser('cm-owner');
    const editor = await createUser('cm-editor');
    const board = await createBoard(owner);
    await share(board.id, owner, editor, 'EDITOR');
    const column = await createColumn(owner.bearer, board.id, 'To Do');
    const task = await createTask(owner.bearer, board.id, column.id, 'Ship comments');

    const empty = await api('GET', `/api/boards/${board.id}/tasks/${task.id}/comments`, {
      bearer: owner.bearer,
    });
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { comments: unknown[] }).comments).toEqual([]);

    const ownerComment = await addComment(owner.bearer, board.id, task.id, 'First pass done.');
    const editorComment = await addComment(editor.bearer, board.id, task.id, 'Nice, reviewing now.');

    const list = await api('GET', `/api/boards/${board.id}/tasks/${task.id}/comments`, {
      bearer: editor.bearer,
    });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      comments: { id: string; content: string; author: { email: string }; taskId: string }[];
    };
    expect(listBody.comments).toHaveLength(2);
    expect(listBody.comments[0]).toEqual({
      id: ownerComment.id,
      content: 'First pass done.',
      author: expect.objectContaining({ email: owner.email }),
      taskId: task.id,
      createdAt: expect.any(String),
    });
    expect(listBody.comments[1]?.author.email).toBe(editor.email);

    const auditCount = await prisma.auditEvent.count({
      where: { boardId: board.id, action: 'COMMENT_ADDED' },
    });
    expect(auditCount).toBe(2);

    // An EDITOR can moderate (delete) any comment on the board.
    const remove = await api(
      'DELETE',
      `/api/boards/${board.id}/tasks/${task.id}/comments/${editorComment.id}`,
      { bearer: owner.bearer },
    );
    expect(remove.status).toBe(204);

    const afterRemove = await api('GET', `/api/boards/${board.id}/tasks/${task.id}/comments`, {
      bearer: owner.bearer,
    });
    const afterBody = (await afterRemove.json()) as { comments: { id: string }[] };
    expect(afterBody.comments.map((c) => c.id)).toEqual([ownerComment.id]);

    const invalid = await api('POST', `/api/boards/${board.id}/tasks/${task.id}/comments`, {
      bearer: owner.bearer,
      body: { content: '   ' },
    });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );

    const missingTask = await api('POST', `/api/boards/${board.id}/tasks/ghost/comments`, {
      bearer: owner.bearer,
      body: { content: 'hi' },
    });
    expect(missingTask.status).toBe(404);
  });

  it('keeps VIEWERs read-only and strangers out entirely', async () => {
    const owner = await createUser('cm2-owner');
    const viewer = await createUser('cm2-viewer');
    const stranger = await createUser('cm2-stranger');
    const board = await createBoard(owner);
    await share(board.id, owner, viewer, 'VIEWER');
    const column = await createColumn(owner.bearer, board.id, 'To Do');
    const task = await createTask(owner.bearer, board.id, column.id, 'Gated comments');
    const comment = await addComment(owner.bearer, board.id, task.id, 'Can you see this?');

    const viewerList = await api('GET', `/api/boards/${board.id}/tasks/${task.id}/comments`, {
      bearer: viewer.bearer,
    });
    expect(viewerList.status).toBe(200);

    const viewerAdd = await api('POST', `/api/boards/${board.id}/tasks/${task.id}/comments`, {
      bearer: viewer.bearer,
      body: { content: 'Nope' },
    });
    expect(viewerAdd.status).toBe(403);

    const viewerDelete = await api(
      'DELETE',
      `/api/boards/${board.id}/tasks/${task.id}/comments/${comment.id}`,
      { bearer: viewer.bearer },
    );
    expect(viewerDelete.status).toBe(403);

    const strangerList = await api('GET', `/api/boards/${board.id}/tasks/${task.id}/comments`, {
      bearer: stranger.bearer,
    });
    expect(strangerList.status).toBe(403);
  });

  it('404s for comments on tasks outside the board scope', async () => {
    const ownerA = await createUser('cm3-owner-a');
    const ownerB = await createUser('cm3-owner-b');
    const boardA = await createBoard(ownerA, 'Board A');
    const boardB = await createBoard(ownerB, 'Board B');
    const columnB = await createColumn(ownerB.bearer, boardB.id, 'B Col');
    const taskB = await createTask(ownerB.bearer, boardB.id, columnB.id, 'B task');
    const commentB = await addComment(ownerB.bearer, boardB.id, taskB.id, 'B comment');

    // ownerA cannot comment on a task that lives in ownerB's board.
    const crossAdd = await api('POST', `/api/boards/${boardA.id}/tasks/${taskB.id}/comments`, {
      bearer: ownerA.bearer,
      body: { content: 'Wrong board' },
    });
    expect(crossAdd.status).toBe(404);
    expect(((await crossAdd.json()) as { error: { code: string } }).error.code).toBe(
      'TASK_NOT_FOUND',
    );

    // ...nor list or delete comments under that task through board A.
    const crossList = await api('GET', `/api/boards/${boardA.id}/tasks/${taskB.id}/comments`, {
      bearer: ownerA.bearer,
    });
    expect(crossList.status).toBe(404);

    const crossDelete = await api(
      'DELETE',
      `/api/boards/${boardA.id}/tasks/${taskB.id}/comments/${commentB.id}`,
      { bearer: ownerA.bearer },
    );
    expect(crossDelete.status).toBe(404);
    expect(((await crossDelete.json()) as { error: { code: string } }).error.code).toBe(
      'COMMENT_NOT_FOUND',
    );

    const ghostDelete = await api(
      'DELETE',
      `/api/boards/${boardA.id}/tasks/ghost/comments/ghost-comment`,
      { bearer: ownerA.bearer },
    );
    expect(ghostDelete.status).toBe(404);
  });
});

describe('activity feed', () => {
  it('lists audit events newest-first with actor details', async () => {
    const owner = await createUser('af-owner');
    const editor = await createUser('af-editor');
    const viewer = await createUser('af-viewer');
    const board = await createBoard(owner);
    await share(board.id, owner, editor, 'EDITOR');
    await share(board.id, owner, viewer, 'VIEWER');
    const todo = await createColumn(owner.bearer, board.id, 'To Do');
    const done = await createColumn(owner.bearer, board.id, 'Done');
    const task = await createTask(owner.bearer, board.id, todo.id, 'Feed task');
    await addComment(editor.bearer, board.id, task.id, 'Activity shows this.');

    const move = await api('PATCH', `/api/boards/${board.id}/tasks/${task.id}/move`, {
      bearer: owner.bearer,
      body: { columnId: done.id },
    });
    expect(move.status).toBe(200);

    const res = await getActivity(board.id, owner.bearer);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: ActivityEvent[]; nextCursor: string | null };
    const actions = body.events.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'BOARD_CREATED',
        'MEMBER_ADDED',
        'COLUMN_CREATED',
        'TASK_CREATED',
        'COMMENT_ADDED',
        'TASK_MOVED',
      ]),
    );
    expect(body.events[0]?.action).toBe('TASK_MOVED'); // newest first
    expect(body.events[0]?.metadata).toEqual(
      expect.objectContaining({ fromColumn: todo.id, toColumn: done.id }),
    );

    const timestamps = body.events.map((e) => Date.parse(e.createdAt));
    for (let i = 1; i < timestamps.length; i += 1) {
      expect(timestamps[i - 1] ?? 0).toBeGreaterThanOrEqual(timestamps[i] ?? 0);
    }

    for (const event of body.events) {
      expect(event.actor.email).toMatch(/@example\.test$/);
    }
    expect(body.events.some((e) => e.actor.email === editor.email)).toBe(true);

    // VIEWERs may read the feed; strangers may not.
    const asViewer = await getActivity(board.id, viewer.bearer);
    expect(asViewer.status).toBe(200);

    const stranger = await createUser('af-stranger');
    const asStranger = await getActivity(board.id, stranger.bearer);
    expect(asStranger.status).toBe(403);
  });

  it('paginates with a stable cursor and validates query params', async () => {
    const owner = await createUser('pg-owner');
    const board = await createBoard(owner);
    const column = await createColumn(owner.bearer, board.id, 'Backlog');

    // 12 task creations on top of board + column + share-less setup events.
    for (let i = 1; i <= 12; i += 1) {
      await createTask(owner.bearer, board.id, column.id, `Task ${i}`);
    }

    const firstPage = await getActivity(board.id, owner.bearer, '?limit=5');
    const firstBody = (await firstPage.json()) as { events: ActivityEvent[]; nextCursor: string | null };
    expect(firstBody.events).toHaveLength(5);
    expect(firstBody.nextCursor).toBe(firstBody.events[4]?.id ?? null);

    const secondPage = await getActivity(
      board.id,
      owner.bearer,
      `?limit=5&cursor=${encodeURIComponent(firstBody.nextCursor ?? '')}`,
    );
    const secondBody = (await secondPage.json()) as {
      events: ActivityEvent[];
      nextCursor: string | null;
    };
    expect(secondBody.events).toHaveLength(5);

    const thirdPage = await getActivity(
      board.id,
      owner.bearer,
      `?limit=5&cursor=${encodeURIComponent(secondBody.nextCursor ?? '')}`,
    );
    const thirdBody = (await thirdPage.json()) as {
      events: ActivityEvent[];
      nextCursor: string | null;
    };
    expect(thirdBody.events.length).toBeGreaterThan(0);
    expect(thirdBody.events.length).toBeLessThanOrEqual(5);
    expect(thirdBody.nextCursor).toBeNull();

    const ids = [
      ...firstBody.events.map((e) => e.id),
      ...secondBody.events.map((e) => e.id),
      ...thirdBody.events.map((e) => e.id),
    ];
    expect(new Set(ids).size).toBe(ids.length); // no overlap across pages

    const total = await prisma.auditEvent.count({ where: { boardId: board.id } });
    expect(ids.length).toBe(total);

    const zero = await getActivity(board.id, owner.bearer, '?limit=0');
    expect(zero.status).toBe(400);

    const huge = await getActivity(board.id, owner.bearer, '?limit=500');
    expect(huge.status).toBe(400);

    const badCursor = await getActivity(board.id, owner.bearer, '?cursor=nope');
    expect(badCursor.status).toBe(400);
    expect(((await badCursor.json()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });
});
