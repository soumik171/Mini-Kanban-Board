/**
 * Development seed: creates two demo accounts and a shared "Demo Kanban"
 * board pre-populated with columns, tasks, comments, and a realistic audit
 * trail, so the UI phases have data to render from day one.
 *
 * Run with: npm run db:seed (idempotent - skips if the demo board exists)
 */
import bcrypt from 'bcryptjs';

import { recordAudit } from '../src/lib/audit.js';
import { prisma } from '../src/lib/prisma.js';

const DEMO_PASSWORD = 'demo-password-1';
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number): Date => new Date(Date.now() + days * DAY_MS);

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

async function addTask(
  boardId: string,
  actorId: string,
  columnId: string,
  input: {
    title: string;
    description?: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    assigneeId?: string;
    labels?: string[];
    dueDate?: Date;
  },
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

async function main() {
  const demo = await ensureUser('demo@test.com', 'Demo User');
  const teammate = await ensureUser('teammate@test.com', 'Teammate');

  const existingBoard = await prisma.board.findFirst({
    where: { title: 'Demo Kanban', ownerId: demo.id },
    select: { id: true },
  });
  if (existingBoard) {
    console.log('Demo board "Demo Kanban" already exists — skipping.');
    return;
  }

  // Board + sharing.
  const board = await prisma.board.create({
    data: {
      title: 'Demo Kanban',
      description: 'Sample board for exploring the mini kanban app',
      ownerId: demo.id,
    },
  });
  console.log(`  • created board "Demo Kanban" (${board.id})`);
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
  const columnDefs = ['To Do', 'In Progress', 'Done'] as const;
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
  const todo = columns[0];
  const inProgress = columns[1];
  const done = columns[2];
  if (!todo || !inProgress || !done) {
    throw new Error('Failed to create demo columns');
  }

  // Tasks in each column.
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

  console.log('  • created 3 columns, 7 tasks, a cross-column move, and 2 comments');
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
