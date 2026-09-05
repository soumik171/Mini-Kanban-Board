import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { broadcastBoardChange, recordAudit } from '../lib/audit.js';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { parseBody } from '../lib/validation.js';
import { currentUserId } from '../middleware/auth.js';
import { currentBoardAccess, requireBoardAccess } from '../middleware/board-access.js';
import type { BoardWithOwner } from '../middleware/board-access.js';

const columnTitleSchema = z.string().trim().min(1, 'Title is required').max(120);

const createColumnSchema = z.object({ title: columnTitleSchema });
const renameColumnSchema = z.object({ title: columnTitleSchema });

const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const dueDateSchema = z.string().datetime({ offset: true });
const labelsSchema = z
  .array(z.string().trim().min(1, 'Label cannot be empty').max(50))
  .max(20);

const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(5000).nullish(),
  priority: prioritySchema.optional(),
  dueDate: dueDateSchema.nullish(),
  labels: labelsSchema.optional(),
  assigneeId: z.string().trim().min(1).nullish(),
});

const updateTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  priority: prioritySchema.optional(),
  dueDate: dueDateSchema.nullable().optional(),
  labels: labelsSchema.optional(),
  assigneeId: z.string().trim().min(1).nullable().optional(),
});

// beforeTaskId is the task the moved task should land in front of; omit it
// (or pass null) to append the task to the end of the target column.
const moveTaskSchema = z.object({
  columnId: z.string().trim().min(1, 'columnId is required'),
  beforeTaskId: z.string().trim().min(1).nullish(),
});

const commentSchema = z.object({
  content: z.string().trim().min(1, 'Comment cannot be empty').max(2000),
});

const taskSummarySelect = {
  id: true,
  title: true,
  description: true,
  position: true,
  priority: true,
  dueDate: true,
  labels: true,
  assignee: { select: { id: true, email: true, name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TaskSelect;

type TaskSummary = Prisma.TaskGetPayload<{ select: typeof taskSummarySelect }>;

const taskDetailSelect = { ...taskSummarySelect, columnId: true } satisfies Prisma.TaskSelect;

type TaskDetail = Prisma.TaskGetPayload<{ select: typeof taskDetailSelect }>;

const columnWithTasksSelect = {
  id: true,
  title: true,
  position: true,
  createdAt: true,
  updatedAt: true,
  tasks: { orderBy: { position: 'asc' }, select: taskSummarySelect },
} satisfies Prisma.ColumnSelect;

type ColumnWithTasks = Prisma.ColumnGetPayload<{ select: typeof columnWithTasksSelect }>;

const commentSelect = {
  id: true,
  content: true,
  taskId: true,
  createdAt: true,
  author: { select: { id: true, email: true, name: true } },
} satisfies Prisma.CommentSelect;

type CommentSummary = Prisma.CommentGetPayload<{ select: typeof commentSelect }>;

function taskJson(task: TaskSummary) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    position: task.position,
    priority: task.priority,
    dueDate: task.dueDate,
    labels: task.labels,
    assignee: task.assignee,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function taskDetailJson(task: TaskDetail) {
  return { ...taskJson(task), columnId: task.columnId };
}

function commentJson(comment: CommentSummary) {
  return {
    id: comment.id,
    content: comment.content,
    taskId: comment.taskId,
    author: comment.author,
    createdAt: comment.createdAt,
  };
}

function columnJson(column: ColumnWithTasks) {
  return {
    id: column.id,
    title: column.title,
    position: column.position,
    createdAt: column.createdAt,
    updatedAt: column.updatedAt,
    tasks: column.tasks.map(taskJson),
  };
}

async function findBoardColumn(boardId: string, columnId: string) {
  const column = await prisma.column.findFirst({
    where: { id: columnId, boardId },
  });
  if (!column) {
    throw new HttpError(404, 'COLUMN_NOT_FOUND', 'Column not found');
  }
  return column;
}

async function findBoardTask(boardId: string, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { boardId } },
    select: { id: true },
  });
  if (!task) {
    throw new HttpError(404, 'TASK_NOT_FOUND', 'Task not found');
  }
  return task;
}

async function assertAssigneeOnBoard(board: BoardWithOwner, assigneeId: string): Promise<void> {
  // The owner is always implicitly on the board.
  if (assigneeId === board.ownerId) {
    return;
  }
  const member = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: board.id, userId: assigneeId } },
    select: { id: true },
  });
  if (!member) {
    throw new HttpError(400, 'USER_NOT_ON_BOARD', 'Assignee must be a member of this board');
  }
}

/**
 * Returns a float strictly between the neighbouring positions (or beyond the
 * column's start/end), or null when no representable float fits in the gap -
 * at which point the caller compacts the column's positions and retries.
 */
function gapPosition(lower: number | null, upper: number | null): number | null {
  if (lower === null) {
    if (upper === null) {
      return 1; // first task into an empty column
    }
    // Top of the column: split the head position in half.
    const pos = upper / 2;
    return pos > 0 && pos < upper ? pos : null;
  }
  if (upper === null) {
    // End of the column: one past the tail position.
    const pos = lower + 1;
    return pos > lower ? pos : null;
  }
  const pos = (lower + upper) / 2;
  return pos > lower && pos < upper ? pos : null;
}

/**
 * Column + task CRUD scoped under a board. Mounted inside the boards router
 * at /api/boards/:boardId, so requireAuth and the :boardId param come from
 * the parent (mergeParams). requireBoardAccess handles the access check and
 * stashes the resolved board + role for each route.
 */
export const boardContentRouter = Router({ mergeParams: true });

boardContentRouter.get('/columns', requireBoardAccess(), async (_req, res) => {
  const { board } = currentBoardAccess(res);
  const columns = await prisma.column.findMany({
    where: { boardId: board.id },
    select: columnWithTasksSelect,
    orderBy: { position: 'asc' },
  });
  res.json({ columns: columns.map(columnJson) });
});

boardContentRouter.post('/columns', requireBoardAccess('EDITOR'), async (req, res) => {
  const { title } = parseBody(createColumnSchema, req);
  const { board } = currentBoardAccess(res);
  const actorId = currentUserId(res);

  const last = await prisma.column.findFirst({
    where: { boardId: board.id },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const position = (last?.position ?? 0) + 1;

  const column = await prisma.column.create({
    data: { boardId: board.id, title, position },
    select: columnWithTasksSelect,
  });
  await recordAudit({
    boardId: board.id,
    actorId,
    action: 'COLUMN_CREATED',
    entityType: 'column',
    entityId: column.id,
    metadata: { title, position },
  });

  res.status(201).json({ column: columnJson(column) });
});

boardContentRouter.patch('/columns/:columnId', requireBoardAccess('EDITOR'), async (req, res) => {
  const { title } = parseBody(renameColumnSchema, req);
  const { board } = currentBoardAccess(res);
  const actorId = currentUserId(res);

  const column = await findBoardColumn(board.id, req.params.columnId as string);
  const updated = await prisma.column.update({
    where: { id: column.id },
    data: { title },
    select: columnWithTasksSelect,
  });
  await recordAudit({
    boardId: board.id,
    actorId,
    action: 'COLUMN_UPDATED',
    entityType: 'column',
    entityId: column.id,
    metadata: { oldTitle: column.title, title },
  });

  res.json({ column: columnJson(updated) });
});

boardContentRouter.delete('/columns/:columnId', requireBoardAccess('EDITOR'), async (req, res) => {
  const { board } = currentBoardAccess(res);
  const actorId = currentUserId(res);

  const column = await findBoardColumn(board.id, req.params.columnId as string);
  // Tasks (and their comments) cascade with the column.
  await prisma.column.delete({ where: { id: column.id } });
  await recordAudit({
    boardId: board.id,
    actorId,
    action: 'COLUMN_DELETED',
    entityType: 'column',
    entityId: column.id,
    metadata: { title: column.title },
  });

  res.status(204).end();
});

boardContentRouter.post(
  '/columns/:columnId/tasks',
  requireBoardAccess('EDITOR'),
  async (req, res) => {
    const data = parseBody(createTaskSchema, req);
    const { board } = currentBoardAccess(res);
    const actorId = currentUserId(res);

    const column = await findBoardColumn(board.id, req.params.columnId as string);

    const assigneeId = data.assigneeId ?? null;
    if (assigneeId) {
      await assertAssigneeOnBoard(board, assigneeId);
    }

    const last = await prisma.task.findFirst({
      where: { columnId: column.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = (last?.position ?? 0) + 1;

    const task = await prisma.task.create({
      data: {
        columnId: column.id,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority ?? 'MEDIUM',
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        labels: data.labels ?? [],
        position,
        assigneeId,
      },
      select: taskDetailSelect,
    });
    await recordAudit({
      boardId: board.id,
      actorId,
      action: 'TASK_CREATED',
      entityType: 'task',
      entityId: task.id,
      metadata: { columnId: column.id, position },
    });

    res.status(201).json({ task: taskDetailJson(task) });
  },
);

boardContentRouter.get('/tasks/:taskId', requireBoardAccess(), async (req, res) => {
  const { board } = currentBoardAccess(res);
  const task = await prisma.task.findFirst({
    where: { id: req.params.taskId as string, column: { boardId: board.id } },
    select: taskDetailSelect,
  });
  if (!task) {
    throw new HttpError(404, 'TASK_NOT_FOUND', 'Task not found');
  }
  res.json({ task: taskDetailJson(task) });
});

boardContentRouter.patch('/tasks/:taskId', requireBoardAccess('EDITOR'), async (req, res) => {
  const data = parseBody(updateTaskSchema, req);
  const fields = Object.keys(data);
  if (fields.length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Provide at least one field to update');
  }
  const { board } = currentBoardAccess(res);
  const actorId = currentUserId(res);

  const task = await prisma.task.findFirst({
    where: { id: req.params.taskId as string, column: { boardId: board.id } },
    select: taskDetailSelect,
  });
  if (!task) {
    throw new HttpError(404, 'TASK_NOT_FOUND', 'Task not found');
  }

  let assigneeId: string | null | undefined;
  if (data.assigneeId !== undefined) {
    if (data.assigneeId === null) {
      assigneeId = null;
    } else {
      await assertAssigneeOnBoard(board, data.assigneeId);
      assigneeId = data.assigneeId;
    }
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.priority !== undefined && { priority: data.priority }),
      ...(data.dueDate !== undefined && {
        dueDate: data.dueDate === null ? null : new Date(data.dueDate),
      }),
      ...(data.labels !== undefined && { labels: data.labels }),
      ...(assigneeId !== undefined && { assigneeId }),
    },
    select: taskDetailSelect,
  });
  await recordAudit({
    boardId: board.id,
    actorId,
    action: 'TASK_UPDATED',
    entityType: 'task',
    entityId: task.id,
    metadata: { fields },
  });

  res.json({ task: taskDetailJson(updated) });
});

boardContentRouter.delete('/tasks/:taskId', requireBoardAccess('EDITOR'), async (req, res) => {
  const { board } = currentBoardAccess(res);
  const actorId = currentUserId(res);

  const task = await prisma.task.findFirst({
    where: { id: req.params.taskId as string, column: { boardId: board.id } },
    select: { id: true, title: true, columnId: true },
  });
  if (!task) {
    throw new HttpError(404, 'TASK_NOT_FOUND', 'Task not found');
  }

  await prisma.task.delete({ where: { id: task.id } });
  await recordAudit({
    boardId: board.id,
    actorId,
    action: 'TASK_DELETED',
    entityType: 'task',
    entityId: task.id,
    metadata: { title: task.title, columnId: task.columnId },
  });

  res.status(204).end();
});

boardContentRouter.patch(
  '/tasks/:taskId/move',
  requireBoardAccess('EDITOR'),
  async (req, res) => {
    const data = parseBody(moveTaskSchema, req);
    const { board } = currentBoardAccess(res);
    const actorId = currentUserId(res);
    const taskId = req.params.taskId as string;

    const task = await prisma.task.findFirst({
      where: { id: taskId, column: { boardId: board.id } },
      select: { id: true, columnId: true, position: true },
    });
    if (!task) {
      throw new HttpError(404, 'TASK_NOT_FOUND', 'Task not found');
    }

    const targetColumn = await prisma.column.findFirst({
      where: { id: data.columnId, boardId: board.id },
      select: { id: true },
    });
    if (!targetColumn) {
      throw new HttpError(404, 'COLUMN_NOT_FOUND', 'Column not found');
    }

    // Current order of the target column, with the moved task removed from the
    // picture; the destination index is where it will be re-inserted.
    const rows = await prisma.task.findMany({
      where: { columnId: targetColumn.id },
      select: { id: true, position: true },
      orderBy: { position: 'asc' },
    });
    const others = rows.filter((row) => row.id !== task.id);

    const anchorId = data.beforeTaskId ?? null;
    let destIndex: number;
    if (anchorId === null) {
      destIndex = others.length; // append to the end
    } else {
      const anchorIndex = others.findIndex((row) => row.id === anchorId);
      if (anchorIndex === -1) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'beforeTaskId must be a task in the target column',
        );
      }
      destIndex = anchorIndex;
    }

    // Dropping a task somewhere that does not change its order is a no-op.
    let noOp = false;
    if (task.columnId === targetColumn.id) {
      if (anchorId === null) {
        noOp = others.every((row) => row.position < task.position); // already last
      } else {
        const anchorRow = rows.findIndex((row) => row.id === anchorId);
        noOp = rows[anchorRow - 1]?.id === task.id; // already directly before the anchor
      }
    }
    if (noOp) {
      const current = await prisma.task.findUnique({
        where: { id: task.id },
        select: taskDetailSelect,
      });
      if (!current) {
        throw new HttpError(404, 'TASK_NOT_FOUND', 'Task not found');
      }
      res.json({ task: taskDetailJson(current) });
      return;
    }

    // Position the task between its future neighbours. When no float fits in
    // the gap, compact the column's tasks to integer positions and retry.
    const lower = destIndex > 0 ? (others[destIndex - 1]?.position ?? null) : null;
    const upper = destIndex < others.length ? (others[destIndex]?.position ?? null) : null;
    let newPosition = gapPosition(lower, upper);
    if (newPosition === null) {
      await prisma.$transaction(
        others.map((row, index) =>
          prisma.task.update({
            where: { id: row.id },
            data: { position: index + 1 },
          }),
        ),
      );
      if (destIndex === 0) {
        newPosition = 0.5;
      } else if (destIndex >= others.length) {
        newPosition = others.length + 1;
      } else {
        newPosition = destIndex + 0.5;
      }
    }

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: { columnId: targetColumn.id, position: newPosition },
      select: taskDetailSelect,
    });
    await recordAudit({
      boardId: board.id,
      actorId,
      action: 'TASK_MOVED',
      entityType: 'task',
      entityId: task.id,
      metadata: {
        fromColumn: task.columnId,
        toColumn: targetColumn.id,
        oldPosition: task.position,
        newPosition,
      },
    });

    res.json({ task: taskDetailJson(updated) });
  },
);

boardContentRouter.get('/tasks/:taskId/comments', requireBoardAccess(), async (req, res) => {
  const { board } = currentBoardAccess(res);
  const taskId = req.params.taskId as string;
  await findBoardTask(board.id, taskId);

  const comments = await prisma.comment.findMany({
    where: { taskId },
    select: commentSelect,
    orderBy: { createdAt: 'asc' },
  });
  res.json({ comments: comments.map(commentJson) });
});

boardContentRouter.post(
  '/tasks/:taskId/comments',
  requireBoardAccess('EDITOR'),
  async (req, res) => {
    const { content } = parseBody(commentSchema, req);
    const { board } = currentBoardAccess(res);
    const actorId = currentUserId(res);
    const taskId = req.params.taskId as string;
    await findBoardTask(board.id, taskId);

    const comment = await prisma.comment.create({
      data: { taskId, authorId: actorId, content },
      select: commentSelect,
    });
    await recordAudit({
      boardId: board.id,
      actorId,
      action: 'COMMENT_ADDED',
      entityType: 'comment',
      entityId: comment.id,
      metadata: { taskId },
    });

    res.status(201).json({ comment: commentJson(comment) });
  },
);

boardContentRouter.delete(
  '/tasks/:taskId/comments/:commentId',
  requireBoardAccess('EDITOR'),
  async (req, res) => {
    const { board } = currentBoardAccess(res);
    const comment = await prisma.comment.findFirst({
      where: {
        id: req.params.commentId as string,
        task: { column: { boardId: board.id } },
      },
      select: { id: true, taskId: true },
    });
    if (!comment) {
      throw new HttpError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
    }

    await prisma.comment.delete({ where: { id: comment.id } });

    // Comment deletion is deliberately not persisted to the activity feed,
    // but open dialogs still need to drop the comment live.
    broadcastBoardChange(board.id, {
      id: `comment-deleted:${comment.id}`,
      action: 'COMMENT_DELETED',
      entityType: 'comment',
      entityId: comment.id,
      metadata: { taskId: comment.taskId },
      actorId: currentUserId(res),
    });
    res.status(204).end();
  },
);
