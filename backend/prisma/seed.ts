/**
 * Development seed: creates two demo accounts and a shared
 * "E-Commerce Customer Portal" board pre-populated with five columns
 * (Backlog, To Do, In Progress, Review, Done), tasks, comments, and a
 * realistic audit trail.
 *
 * Run with: npm run db:seed (idempotent). If the demo board is missing it is
 * created from scratch; if it already exists (e.g. from an older seed with
 * three columns) it is upgraded in place to the five-column layout without
 * touching tasks the user added themselves. A board created under the old
 * "Demo Kanban" name is renamed in place rather than duplicated.
 */
import type { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { recordAudit } from '../src/lib/audit.js';
import { prisma } from '../src/lib/prisma.js';

const DEMO_PASSWORD = 'demo-password-1';
const DEMO_BOARD_TITLE = 'E-Commerce Customer Portal';
const LEGACY_DEMO_BOARD_TITLE = 'Demo Kanban';
const DEMO_BOARD_DESCRIPTION =
  'Customer-facing portal for the e-commerce storefront — tracking design, backend, and launch work.';
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number): Date => new Date(Date.now() + days * DAY_MS);

const COLUMN_ORDER = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'] as const;

type DbColumn = { id: string; title: string };

type TaskSeed = {
  title: string;
  description?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  assigneeId?: string;
  labels?: string[];
  dueDate?: Date;
};

async function ensureUser(email: string, name: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`  • user ${email} already exists (reusing)`);
    return existing;
  }
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await prisma.user.create({ data: { email, name, passwordHash } });
  console.log(`  • created user ${email} with password "${DEMO_PASSWORD}"`);
  return user;
}

/**
 * Makes sure the board has the canonical five columns, adding whatever is
 * missing and renumbering them so they read left-to-right in kanban order.
 * Existing columns and their tasks are never deleted or overwritten.
 */
async function ensureDemoColumns(
  boardId: string,
  actorId: string,
): Promise<{ backlog: DbColumn | null; review: DbColumn | null; done: DbColumn | null }> {
  const existing = await prisma.column.findMany({
    where: { boardId },
    orderBy: { position: 'asc' },
    select: { id: true, title: true },
  });
  const byTitle = new Map(existing.map((column) => [column.title, column]));

  const added: DbColumn[] = [];
  for (const title of COLUMN_ORDER) {
    if (byTitle.has(title)) continue;
    const column = await prisma.column.create({
      data: { boardId, title, position: 100 + added.length },
    });
    added.push(column);
    byTitle.set(title, column);
    await recordAudit({
      boardId,
      actorId,
      action: 'COLUMN_CREATED',
      entityType: 'column',
      entityId: column.id,
      metadata: { title },
    });
    console.log(`  • added column "${title}"`);
  }

  // Renumber so the canonical columns sit first in order, and any extra
  // columns the user created on their own keep following after.
  if (added.length > 0) {
    const all = await prisma.column.findMany({
      where: { boardId },
      select: { id: true, title: true },
    });
    const canonical = new Set<string>(COLUMN_ORDER);
    const order = [
      ...COLUMN_ORDER,
      ...all.map((column) => column.title).filter((title) => !canonical.has(title)),
    ];
    const updates: Prisma.PrismaPromise<unknown>[] = [];
    for (const [index, title] of order.entries()) {
      const column = all.find((candidate) => candidate.title === title);
      if (!column) continue;
      updates.push(
        prisma.column.update({ where: { id: column.id }, data: { position: index + 1 } }),
      );
    }
    await prisma.$transaction(updates);
  }

  const find = (title: string): DbColumn | null => {
    const column = byTitle.get(title);
    return column ? { id: column.id, title: column.title } : null;
  };
  return { backlog: find('Backlog'), review: find('Review'), done: find('Done') };
}

async function addTask(
  boardId: string,
  actorId: string,
  columnId: string,
  input: TaskSeed,
) {
  const last = await prisma.task.findFirst({
    where: { columnId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const position = (last?.position ?? 0) + 1;
  const task = await prisma.task.create({
    data: {
      columnId,
      position,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'MEDIUM',
      assigneeId: input.assigneeId ?? null,
      labels: input.labels ?? [],
      dueDate: input.dueDate ?? null,
    },
  });
  await recordAudit({
    boardId,
    actorId,
    action: 'TASK_CREATED',
    entityType: 'task',
    entityId: task.id,
    metadata: { columnId, position },
  });
  return task;
}

/**
 * Adds cards from `samples` to `column` until it holds at least `minimum`
 * tasks. Existing cards (by title) are never duplicated, so running the seed
 * again is safe. Used to keep every stage of the board visually balanced.
 */
async function ensureMinimumTasks(
  boardId: string,
  actorId: string,
  column: DbColumn | null,
  samples: TaskSeed[],
  minimum: number,
) {
  if (!column) return;
  const existing = await prisma.task.findMany({
    where: { columnId: column.id },
    select: { title: true },
  });
  const titles = new Set(existing.map((task) => task.title));
  for (const sample of samples) {
    if (titles.has(sample.title)) continue;
    const count = await prisma.task.count({ where: { columnId: column.id } });
    if (count >= minimum) break;
    await addTask(boardId, actorId, column.id, sample);
    titles.add(sample.title);
  }
}

async function main() {
  const demo = await ensureUser('demo@test.com', 'Demo User');
  const teammate = await ensureUser('teammate@test.com', 'Teammate');

  // Extra sample cards that keep the Review and Done columns populated too.
  const reviewSamples: TaskSeed[] = [
    {
      title: 'Review drag-and-drop ghost PR',
      description: 'Verify the flicker fix on Safari and with trackpad users.',
      priority: 'HIGH',
      assigneeId: demo.id,
      labels: ['frontend', 'review'],
      dueDate: daysFromNow(1),
    },
    {
      title: 'Check activity feed on mobile',
      description: 'Confirm the audit trail layout on narrow screens.',
      priority: 'MEDIUM',
      assigneeId: teammate.id,
      labels: ['frontend', 'review'],
      dueDate: daysFromNow(2),
    },
  ];
  const doneSamples: TaskSeed[] = [
    {
      title: 'Email notifications',
      description: 'Welcome email plus a digest for board activity.',
      priority: 'MEDIUM',
      assigneeId: teammate.id,
      labels: ['backend'],
    },
    {
      title: 'Rate limiting on auth routes',
      description: 'Protect login and register endpoints from brute force.',
      priority: 'HIGH',
      assigneeId: demo.id,
      labels: ['backend', 'infra'],
    },
    {
      title: '404 page polish',
      description: 'Friendly not-found page with a link back to boards.',
      priority: 'LOW',
      assigneeId: demo.id,
      labels: ['frontend'],
    },
  ];

  // Find the demo board under its current or legacy name so an existing
  // database (local or live) is renamed in place instead of gaining a second
  // demo board.
  const existingBoard = await prisma.board.findFirst({
    where: {
      ownerId: demo.id,
      OR: [{ title: DEMO_BOARD_TITLE }, { title: LEGACY_DEMO_BOARD_TITLE }],
    },
    select: { id: true, title: true },
  });
  if (existingBoard) {
    if (existingBoard.title !== DEMO_BOARD_TITLE) {
      await prisma.board.update({
        where: { id: existingBoard.id },
        data: { title: DEMO_BOARD_TITLE, description: DEMO_BOARD_DESCRIPTION },
      });
      console.log(`  • renamed demo board "${existingBoard.title}" → "${DEMO_BOARD_TITLE}"`);
    }
    console.log(`Demo board "${DEMO_BOARD_TITLE}" already exists — upgrading to five columns.`);
    const { backlog, review, done } = await ensureDemoColumns(existingBoard.id, demo.id);

    // Fill newly available columns with a few sample cards when they are
    // empty, so every stage of the board feels populated.
    if (backlog && (await prisma.task.count({ where: { columnId: backlog.id } })) === 0) {
      await addTask(existingBoard.id, demo.id, backlog.id, {
        title: 'Investigate realtime API alternatives',
        description: 'Research connection limits and horizontal scaling for the live stream.',
        priority: 'LOW',
        labels: ['backend', 'infra'],
        dueDate: daysFromNow(20),
      });
      await addTask(existingBoard.id, demo.id, backlog.id, {
        title: 'Dark mode support',
        description: 'Add a theme toggle and persist the preference per user.',
        priority: 'LOW',
        assigneeId: teammate.id,
        labels: ['design', 'frontend'],
        dueDate: daysFromNow(14),
      });
    }
    if (review && (await prisma.task.count({ where: { columnId: review.id } })) === 0) {
      await addTask(existingBoard.id, demo.id, review.id, {
        title: 'Polish profile page',
        description: 'Avatar upload, bio field, and responsive layout fixes.',
        priority: 'MEDIUM',
        assigneeId: demo.id,
        labels: ['frontend'],
        dueDate: daysFromNow(1),
      });
    }

    // Balance the board: Review and Done get a few extra cards when needed.
    await ensureMinimumTasks(existingBoard.id, demo.id, review, reviewSamples, 3);
    await ensureMinimumTasks(existingBoard.id, demo.id, done, doneSamples, 4);

    console.log('\nDone. Demo board is ready with all five columns balanced.');
    return;
  }

  // Board + sharing.
  const board = await prisma.board.create({
    data: {
      title: DEMO_BOARD_TITLE,
      description: DEMO_BOARD_DESCRIPTION,
      ownerId: demo.id,
    },
  });
  console.log(`  • created board "${DEMO_BOARD_TITLE}" (${board.id})`);
  await recordAudit({
    boardId: board.id,
    actorId: demo.id,
    action: 'BOARD_CREATED',
    entityType: 'board',
    entityId: board.id,
  });

  await prisma.boardMember.create({
    data: { boardId: board.id, userId: teammate.id, role: 'EDITOR' },
  });
  await recordAudit({
    boardId: board.id,
    actorId: demo.id,
    action: 'MEMBER_ADDED',
    entityType: 'member',
    entityId: teammate.id,
    metadata: { email: teammate.email, role: 'EDITOR' },
  });

  // Columns.
  const columnDefs = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'] as const;
  const columns: { id: string; title: string }[] = [];
  for (const [index, title] of columnDefs.entries()) {
    const column = await prisma.column.create({
      data: { boardId: board.id, title, position: index + 1 },
    });
    columns.push(column);
    await recordAudit({
      boardId: board.id,
      actorId: demo.id,
      action: 'COLUMN_CREATED',
      entityType: 'column',
      entityId: column.id,
      metadata: { title, position: index + 1 },
    });
  }
  const backlog = columns[0];
  const todo = columns[1];
  const inProgress = columns[2];
  const review = columns[3];
  const done = columns[4];
  if (!backlog || !todo || !inProgress || !review || !done) {
    throw new Error('Failed to create demo columns');
  }

  // Tasks in each column.
  await addTask(board.id, demo.id, backlog.id, {
    title: 'Investigate WebSocket scaling',
    description: 'Research connection limits and horizontal scaling options for the SSE stream.',
    priority: 'LOW',
    labels: ['backend', 'infra'],
    dueDate: daysFromNow(20),
  });
  await addTask(board.id, demo.id, backlog.id, {
    title: 'Dark mode support',
    description: 'Add a theme toggle and persist the preference per user.',
    priority: 'LOW',
    assigneeId: teammate.id,
    labels: ['design', 'frontend'],
    dueDate: daysFromNow(14),
  });
  await addTask(board.id, demo.id, todo.id, {
    title: 'Write API docs',
    description: 'Document every /api endpoint including roles and error codes.',
    priority: 'LOW',
    assigneeId: teammate.id,
    labels: ['docs'],
    dueDate: daysFromNow(5),
  });
  await addTask(board.id, demo.id, todo.id, {
    title: 'Design landing page',
    description: 'Wireframe and hero section for the marketing page.',
    priority: 'MEDIUM',
    assigneeId: demo.id,
    labels: ['design', 'frontend'],
    dueDate: daysFromNow(10),
  });
  const sharingUi = await addTask(board.id, demo.id, inProgress.id, {
    title: 'Board sharing UI',
    description: 'Invite teammates by email and manage their roles.',
    priority: 'HIGH',
    assigneeId: teammate.id,
    labels: ['frontend'],
    dueDate: daysFromNow(2),
  });
  await addTask(board.id, demo.id, inProgress.id, {
    title: 'Activity feed',
    description: 'Render the audit trail on the board page.',
    priority: 'MEDIUM',
    assigneeId: demo.id,
    labels: ['backend', 'frontend'],
  });
  await addTask(board.id, demo.id, inProgress.id, {
    title: 'Keyboard shortcuts',
    description: 'Escape closes dialogs, arrow keys move tasks, Ctrl+K searches.',
    priority: 'MEDIUM',
    assigneeId: teammate.id,
    labels: ['frontend', 'accessibility'],
  });
  await addTask(board.id, demo.id, review.id, {
    title: 'Profile page polish',
    description: 'Avatar upload, bio field, and responsive layout fixes.',
    priority: 'MEDIUM',
    assigneeId: demo.id,
    labels: ['frontend'],
    dueDate: daysFromNow(1),
  });
  await addTask(board.id, demo.id, done.id, {
    title: 'JWT authentication',
    description: 'Register, login, refresh tokens, and /me.',
    priority: 'HIGH',
    assigneeId: demo.id,
    labels: ['backend'],
  });
  await addTask(board.id, demo.id, done.id, {
    title: 'Board CRUD',
    description: 'Create boards and manage columns and tasks.',
    priority: 'MEDIUM',
    assigneeId: demo.id,
    labels: ['backend'],
  });
  await addTask(board.id, demo.id, done.id, {
    title: 'Testing setup',
    description: 'Vitest suite with factory helpers and an in-memory SQLite stage.',
    priority: 'HIGH',
    assigneeId: teammate.id,
    labels: ['backend', 'tests'],
  });

  // Simulate a cross-column move for a richer feed: created in To Do, then
  // dragged into In Progress.
  const dragTask = await prisma.task.create({
    data: {
      columnId: todo.id,
      position: 3,
      title: 'Fix drag-and-drop ghost',
      description: 'The drag preview flickers on fast pointer moves.',
      priority: 'URGENT',
      assigneeId: demo.id,
      labels: ['bug', 'frontend'],
      dueDate: daysFromNow(1),
    },
  });
  await recordAudit({
    boardId: board.id,
    actorId: demo.id,
    action: 'TASK_CREATED',
    entityType: 'task',
    entityId: dragTask.id,
    metadata: { columnId: todo.id, position: 3 },
  });
  await prisma.task.update({
    where: { id: dragTask.id },
    data: { columnId: inProgress.id, position: 3 },
  });
  await recordAudit({
    boardId: board.id,
    actorId: demo.id,
    action: 'TASK_MOVED',
    entityType: 'task',
    entityId: dragTask.id,
    metadata: { fromColumn: todo.id, toColumn: inProgress.id, oldPosition: 3, newPosition: 3 },
  });

  // A shared task gets its priority bumped by the teammate.
  await prisma.task.update({
    where: { id: sharingUi.id },
    data: { priority: 'URGENT' },
  });
  await recordAudit({
    boardId: board.id,
    actorId: teammate.id,
    action: 'TASK_UPDATED',
    entityType: 'task',
    entityId: sharingUi.id,
    metadata: { fields: ['priority'] },
  });

  // A short comment thread.
  const firstComment = await prisma.comment.create({
    data: { taskId: sharingUi.id, authorId: teammate.id, content: 'Who owns the role picker?' },
  });
  await recordAudit({
    boardId: board.id,
    actorId: teammate.id,
    action: 'COMMENT_ADDED',
    entityType: 'comment',
    entityId: firstComment.id,
    metadata: { taskId: sharingUi.id },
  });
  const reply = await prisma.comment.create({
    data: {
      taskId: sharingUi.id,
      authorId: demo.id,
      content: "I'll take it — inviting you as EDITOR so you can try it.",
    },
  });
  await recordAudit({
    boardId: board.id,
    actorId: demo.id,
    action: 'COMMENT_ADDED',
    entityType: 'comment',
    entityId: reply.id,
    metadata: { taskId: sharingUi.id },
  });

  // Keep every column visually populated on fresh installs too.
  await ensureMinimumTasks(board.id, demo.id, review, reviewSamples, 3);
  await ensureMinimumTasks(board.id, demo.id, done, doneSamples, 4);

  console.log('  • created 5 columns, 15 tasks, a cross-column move, and 2 comments');
  console.log('\nDone. Demo board is ready and its activity feed is populated.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
