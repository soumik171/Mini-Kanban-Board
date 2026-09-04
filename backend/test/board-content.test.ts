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

async function createBoard(owner: AuthedUser, title = 'Content Board'): Promise<{ id: string }> {
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

async function createColumn(
  bearer: string,
  boardId: string,
  title: string,
): Promise<{ id: string; position: number }> {
  const res = await api('POST', `/api/boards/${boardId}/columns`, { bearer, body: { title } });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { column: { id: string; position: number } };
  return body.column;
}

async function createTask(
  bearer: string,
  boardId: string,
  columnId: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await api('POST', `/api/boards/${boardId}/columns/${columnId}/tasks`, {
    bearer,
    body,
  });
  expect(res.status).toBe(201);
  const parsed = (await res.json()) as { task: { id: string } };
  return parsed.task;
}

beforeAll(async () => {
  server = await startTestServer();
  baseUrl = server.baseUrl;
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

describe('board content CRUD', () => {
  it('lets an OWNER or EDITOR rename a board but blocks VIEWERs', async () => {
    const owner = await createUser('be-owner');
    const editor = await createUser('be-editor');
    const viewer = await createUser('be-viewer');
    const board = await createBoard(owner, 'Original');

    await share(board.id, owner, editor, 'EDITOR');
    await share(board.id, owner, viewer, 'VIEWER');

    const viewerPatch = await api('PATCH', `/api/boards/${board.id}`, {
      bearer: viewer.bearer,
      body: { title: 'Nope' },
    });
    expect(viewerPatch.status).toBe(403);

    const editorPatch = await api('PATCH', `/api/boards/${board.id}`, {
      bearer: editor.bearer,
      body: { title: 'Renamed', description: 'Shared planning board' },
    });
    expect(editorPatch.status).toBe(200);
    const editorBody = (await editorPatch.json()) as { board: { title: string; description: string } };
    expect(editorBody.board.title).toBe('Renamed');
    expect(editorBody.board.description).toBe('Shared planning board');

    const detail = await api('GET', `/api/boards/${board.id}`, { bearer: owner.bearer });
    const detailBody = (await detail.json()) as { board: { title: string } };
    expect(detailBody.board.title).toBe('Renamed');

    const audit = await prisma.auditEvent.findFirst({
      where: { boardId: board.id, action: 'BOARD_UPDATED' },
      select: { metadata: true },
    });
    expect(audit).not.toBeNull();
  });

  it('deletes a board only for the OWNER and cascades its content', async () => {
    const owner = await createUser('bd-owner');
    const editor = await createUser('bd-editor');
    const board = await createBoard(owner);

    await share(board.id, owner, editor, 'EDITOR');
    const column = await createColumn(owner.bearer, board.id, 'To Do');
    await createTask(owner.bearer, board.id, column.id, { title: 'Doomed task' });

    const editorDelete = await api('DELETE', `/api/boards/${board.id}`, { bearer: editor.bearer });
    expect(editorDelete.status).toBe(403);

    const ownerDelete = await api('DELETE', `/api/boards/${board.id}`, { bearer: owner.bearer });
    expect(ownerDelete.status).toBe(204);

    const detail = await api('GET', `/api/boards/${board.id}`, { bearer: owner.bearer });
    expect(detail.status).toBe(404);

    const columns = await api('GET', `/api/boards/${board.id}/columns`, { bearer: editor.bearer });
    expect(columns.status).toBe(404);

    const [columnCount, memberCount, auditCount] = await Promise.all([
      prisma.column.count({ where: { boardId: board.id } }),
      prisma.boardMember.count({ where: { boardId: board.id } }),
      prisma.auditEvent.count({ where: { boardId: board.id } }),
    ]);
    expect(columnCount).toBe(0);
    expect(memberCount).toBe(0);
    expect(auditCount).toBe(0);
  });

  it('creates columns with increasing positions in list order', async () => {
    const owner = await createUser('cc-owner');
    const board = await createBoard(owner);

    const first = await createColumn(owner.bearer, board.id, 'To Do');
    const second = await createColumn(owner.bearer, board.id, 'Done');
    expect(first.position).toBe(1);
    expect(second.position).toBe(2);

    const list = await api('GET', `/api/boards/${board.id}/columns`, { bearer: owner.bearer });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      columns: { title: string; position: number; tasks: unknown[] }[];
    };
    expect(listBody.columns.map((c) => c.title)).toEqual(['To Do', 'Done']);
    expect(listBody.columns.map((c) => c.position)).toEqual([1, 2]);
    expect(listBody.columns[0]?.tasks).toEqual([]);

    const auditCount = await prisma.auditEvent.count({
      where: { boardId: board.id, action: 'COLUMN_CREATED' },
    });
    expect(auditCount).toBe(2);
  });

  it('renames and deletes columns, cascading their tasks', async () => {
    const owner = await createUser('col-owner');
    const board = await createBoard(owner);
    const column = await createColumn(owner.bearer, board.id, 'WIP');
    const task = await createTask(owner.bearer, board.id, column.id, { title: 'Inside column' });

    const rename = await api('PATCH', `/api/boards/${board.id}/columns/${column.id}`, {
      bearer: owner.bearer,
      body: { title: 'In Progress' },
    });
    expect(rename.status).toBe(200);
    const renameBody = (await rename.json()) as { column: { title: string } };
    expect(renameBody.column.title).toBe('In Progress');

    const remove = await api('DELETE', `/api/boards/${board.id}/columns/${column.id}`, {
      bearer: owner.bearer,
    });
    expect(remove.status).toBe(204);

    const list = await api('GET', `/api/boards/${board.id}/columns`, { bearer: owner.bearer });
    const listBody = (await list.json()) as { columns: { title: string }[] };
    expect(listBody.columns).not.toContainEqual(expect.objectContaining({ title: 'In Progress' }));

    const gone = await api('GET', `/api/boards/${board.id}/tasks/${task.id}`, {
      bearer: owner.bearer,
    });
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as { error: { code: string } }).error.code).toBe('TASK_NOT_FOUND');
  });

  it('creates tasks with defaults and appends them in the column', async () => {
    const owner = await createUser('ct-owner');
    const member = await createUser('ct-member');
    const board = await createBoard(owner);
    await share(board.id, owner, member, 'EDITOR');
    const column = await createColumn(owner.bearer, board.id, 'Backlog');

    const first = await api('POST', `/api/boards/${board.id}/columns/${column.id}/tasks`, {
      bearer: owner.bearer,
      body: { title: 'First task' },
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      task: {
        id: string;
        position: number;
        priority: string;
        labels: string[];
        description: null;
        dueDate: null;
        assignee: null;
      };
    };
    expect(firstBody.task.position).toBe(1);
    expect(firstBody.task.priority).toBe('MEDIUM');
    expect(firstBody.task.labels).toEqual([]);
    expect(firstBody.task.description).toBeNull();
    expect(firstBody.task.dueDate).toBeNull();
    expect(firstBody.task.assignee).toBeNull();

    const second = await createTask(owner.bearer, board.id, column.id, {
      title: 'Second task',
      priority: 'HIGH',
      description: 'With details',
      dueDate: '2026-08-01T10:00:00.000Z',
      labels: ['bug', 'frontend'],
      assigneeId: member.id,
    });

    const list = await api('GET', `/api/boards/${board.id}/columns`, { bearer: owner.bearer });
    const listBody = (await list.json()) as {
      columns: { tasks: { id: string; position: number; assignee: { id: string } | null }[] }[];
    };
    const tasks = listBody.columns[0]?.tasks ?? [];
    expect(tasks.map((t) => t.id)).toEqual([firstBody.task.id, second.id]);
    expect(tasks.map((t) => t.position)).toEqual([1, 2]);
    expect(tasks[1]?.assignee?.id).toBe(member.id);
  });

  it('updates and clears task fields and validates the assignee', async () => {
    const owner = await createUser('tu-owner');
    const member = await createUser('tu-member');
    const outsider = await createUser('tu-outsider');
    const board = await createBoard(owner);
    await share(board.id, owner, member, 'EDITOR');
    const column = await createColumn(owner.bearer, board.id, 'To Do');
    const task = await createTask(owner.bearer, board.id, column.id, {
      title: 'Old title',
      description: 'Old details',
      priority: 'LOW',
      labels: ['misc'],
    });

    const strangerAssign = await api('PATCH', `/api/boards/${board.id}/tasks/${task.id}`, {
      bearer: owner.bearer,
      body: { assigneeId: outsider.id },
    });
    expect(strangerAssign.status).toBe(400);
    expect(((await strangerAssign.json()) as { error: { code: string } }).error.code).toBe(
      'USER_NOT_ON_BOARD',
    );

    const bogusAssign = await api('PATCH', `/api/boards/${board.id}/tasks/${task.id}`, {
      bearer: owner.bearer,
      body: { assigneeId: 'no-such-user' },
    });
    expect(bogusAssign.status).toBe(400);

    const update = await api('PATCH', `/api/boards/${board.id}/tasks/${task.id}`, {
      bearer: owner.bearer,
      body: {
        title: 'New title',
        priority: 'URGENT',
        description: null,
        labels: [],
        dueDate: '2026-09-15T08:30:00.000Z',
        assigneeId: member.id,
      },
    });
    expect(update.status).toBe(200);
    const updateBody = (await update.json()) as {
      task: {
        title: string;
        priority: string;
        description: null;
        labels: string[];
        dueDate: string;
        assignee: { id: string } | null;
      };
    };
    expect(updateBody.task.title).toBe('New title');
    expect(updateBody.task.priority).toBe('URGENT');
    expect(updateBody.task.description).toBeNull();
    expect(updateBody.task.labels).toEqual([]);
    expect(updateBody.task.dueDate).toBe('2026-09-15T08:30:00.000Z');
    expect(updateBody.task.assignee?.id).toBe(member.id);

    const clear = await api('PATCH', `/api/boards/${board.id}/tasks/${task.id}`, {
      bearer: owner.bearer,
      body: { assigneeId: null, dueDate: null },
    });
    expect(clear.status).toBe(200);
    const clearBody = (await clear.json()) as { task: { assignee: null; dueDate: null } };
    expect(clearBody.task.assignee).toBeNull();
    expect(clearBody.task.dueDate).toBeNull();

    const empty = await api('PATCH', `/api/boards/${board.id}/tasks/${task.id}`, {
      bearer: owner.bearer,
      body: {},
    });
    expect(empty.status).toBe(400);
  });

  it('lets an EDITOR mutate content while VIEWERs stay read-only', async () => {
    const owner = await createUser('role-owner');
    const editor = await createUser('role-editor');
    const viewer = await createUser('role-viewer');
    const board = await createBoard(owner);
    await share(board.id, owner, editor, 'EDITOR');
    await share(board.id, owner, viewer, 'VIEWER');

    const column = await createColumn(editor.bearer, board.id, 'Doing');
    const task = await createTask(editor.bearer, board.id, column.id, { title: 'Editor-made task' });

    const detail = await api('GET', `/api/boards/${board.id}/tasks/${task.id}`, {
      bearer: viewer.bearer,
    });
    expect(detail.status).toBe(200);

    const viewerColumnAdd = await api('POST', `/api/boards/${board.id}/columns`, {
      bearer: viewer.bearer,
      body: { title: 'Nope' },
    });
    expect(viewerColumnAdd.status).toBe(403);

    const viewerTaskAdd = await api('POST', `/api/boards/${board.id}/columns/${column.id}/tasks`, {
      bearer: viewer.bearer,
      body: { title: 'Nope' },
    });
    expect(viewerTaskAdd.status).toBe(403);

    const viewerTaskPatch = await api('PATCH', `/api/boards/${board.id}/tasks/${task.id}`, {
      bearer: viewer.bearer,
      body: { title: 'Nope' },
    });
    expect(viewerTaskPatch.status).toBe(403);

    const viewerTaskDelete = await api('DELETE', `/api/boards/${board.id}/tasks/${task.id}`, {
      bearer: viewer.bearer,
    });
    expect(viewerTaskDelete.status).toBe(403);

    const editorTaskDelete = await api('DELETE', `/api/boards/${board.id}/tasks/${task.id}`, {
      bearer: editor.bearer,
    });
    expect(editorTaskDelete.status).toBe(204);

    const stranger = await createUser('role-stranger');
    const strangerList = await api('GET', `/api/boards/${board.id}/columns`, {
      bearer: stranger.bearer,
    });
    expect(strangerList.status).toBe(403);
  });

  it('404s for columns and tasks outside the board scope', async () => {
    const ownerA = await createUser('scope-a');
    const ownerB = await createUser('scope-b');
    const boardA = await createBoard(ownerA, 'Board A');
    const boardB = await createBoard(ownerB, 'Board B');
    await createColumn(ownerA.bearer, boardA.id, 'A Col');
    const columnB = await createColumn(ownerB.bearer, boardB.id, 'B Col');
    const taskB = await createTask(ownerB.bearer, boardB.id, columnB.id, { title: 'B task' });

    const crossColumn = await api('POST', `/api/boards/${boardA.id}/columns/${columnB.id}/tasks`, {
      bearer: ownerA.bearer,
      body: { title: 'Wrong board' },
    });
    expect(crossColumn.status).toBe(404);
    expect(((await crossColumn.json()) as { error: { code: string } }).error.code).toBe(
      'COLUMN_NOT_FOUND',
    );

    const crossTask = await api('GET', `/api/boards/${boardA.id}/tasks/${taskB.id}`, {
      bearer: ownerA.bearer,
    });
    expect(crossTask.status).toBe(404);
    expect(((await crossTask.json()) as { error: { code: string } }).error.code).toBe(
      'TASK_NOT_FOUND',
    );

    const unknownColumn = await api('PATCH', `/api/boards/${boardA.id}/columns/nope`, {
      bearer: ownerA.bearer,
      body: { title: 'x' },
    });
    expect(unknownColumn.status).toBe(404);
  });

  it('rejects invalid column and task payloads', async () => {
    const owner = await createUser('val-owner');
    const board = await createBoard(owner);
    const column = await createColumn(owner.bearer, board.id, 'To Do');

    const blankColumn = await api('POST', `/api/boards/${board.id}/columns`, {
      bearer: owner.bearer,
      body: { title: '   ' },
    });
    expect(blankColumn.status).toBe(400);

    const badPriority = await api('POST', `/api/boards/${board.id}/columns/${column.id}/tasks`, {
      bearer: owner.bearer,
      body: { title: 'Task', priority: 'EXTREME' },
    });
    expect(badPriority.status).toBe(400);
    expect(((await badPriority.json()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );

    const badDueDate = await api('POST', `/api/boards/${board.id}/columns/${column.id}/tasks`, {
      bearer: owner.bearer,
      body: { title: 'Task', dueDate: 'not-a-date' },
    });
    expect(badDueDate.status).toBe(400);

    const tooManyLabels = await api('POST', `/api/boards/${board.id}/columns/${column.id}/tasks`, {
      bearer: owner.bearer,
      body: { title: 'Task', labels: Array.from({ length: 21 }, () => 'x') },
    });
    expect(tooManyLabels.status).toBe(400);
  });
});
