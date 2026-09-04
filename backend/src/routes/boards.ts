import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { recordAudit } from '../lib/audit.js';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { parseBody } from '../lib/validation.js';
import { currentUserId, requireAuth } from '../middleware/auth.js';
import {
  currentBoardAccess,
  requireBoardAccess,
} from '../middleware/board-access.js';
import { boardContentRouter } from './board-content.js';

const ASSIGNABLE_ROLES = z.enum(['EDITOR', 'VIEWER']);

const createBoardSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120),
  description: z.string().trim().max(1000).nullish(),
});

const shareBoardSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: ASSIGNABLE_ROLES,
});

const changeRoleSchema = z.object({
  role: ASSIGNABLE_ROLES,
});

const updateBoardSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

const boardSummarySelect = {
  id: true,
  title: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, email: true, name: true } },
} satisfies Prisma.BoardSelect;

type BoardSummary = Prisma.BoardGetPayload<{ select: typeof boardSummarySelect }>;

interface PublicUser {
  id: string;
  email: string;
  name: string;
}

function boardJson(board: BoardSummary) {
  return {
    id: board.id,
    title: board.title,
    description: board.description,
    owner: board.owner,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}

export const boardsRouter = Router();

boardsRouter.use(requireAuth);

boardsRouter.post('/', async (req, res) => {
  const { title, description } = parseBody(createBoardSchema, req);
  const ownerId = currentUserId(res);

  const board = await prisma.board.create({
    data: { title, description: description ?? null, ownerId },
    select: boardSummarySelect,
  });
  await recordAudit({
    boardId: board.id,
    actorId: ownerId,
    action: 'BOARD_CREATED',
    entityType: 'board',
    entityId: board.id,
  });

  res.status(201).json({ board: boardJson(board) });
});

boardsRouter.get('/', async (_req, res) => {
  const userId = currentUserId(res);

  const [owned, memberships] = await Promise.all([
    prisma.board.findMany({
      where: { ownerId: userId },
      select: boardSummarySelect,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.boardMember.findMany({
      where: { userId },
      select: { role: true, board: { select: boardSummarySelect } },
      orderBy: { board: { createdAt: 'desc' } },
    }),
  ]);

  const boards = [
    ...owned.map((board) => ({ ...boardJson(board), role: 'OWNER' as const })),
    ...memberships.map((m) => ({ ...boardJson(m.board), role: m.role })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  res.json({ boards });
});

boardsRouter.get('/:boardId', requireBoardAccess(), (req, res) => {
  const { board, role } = currentBoardAccess(res);
  res.json({
    board: {
      id: board.id,
      title: board.title,
      description: board.description,
      owner: board.owner,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
    },
    role,
  });
});

boardsRouter.get('/:boardId/members', requireBoardAccess(), async (req, res) => {
  const { board } = currentBoardAccess(res);

  const rows = await prisma.boardMember.findMany({
    where: { boardId: board.id },
    select: {
      role: true,
      user: { select: { id: true, email: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const members: { user: PublicUser; role: 'OWNER' | 'EDITOR' | 'VIEWER' }[] = [
    {
      user: { id: board.owner.id, email: board.owner.email, name: board.owner.name },
      role: 'OWNER',
    },
    ...rows
      .filter((row) => row.user.id !== board.owner.id)
      .map((row) => ({ user: row.user, role: row.role })),
  ];

  res.json({ members });
});

boardsRouter.post('/:boardId/members', requireBoardAccess('OWNER'), async (req, res) => {
  const { email, role } = parseBody(shareBoardSchema, req);
  const { board } = currentBoardAccess(res);
  const actorId = currentUserId(res);

  if (board.owner.email === email) {
    throw new HttpError(409, 'ALREADY_MEMBER', 'The board owner already has full access');
  }

  const target = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  if (!target) {
    throw new HttpError(404, 'USER_NOT_FOUND', `No user with email "${email}"`);
  }

  const existing = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: board.id, userId: target.id } },
  });
  if (existing) {
    throw new HttpError(409, 'ALREADY_MEMBER', 'This user is already a board member');
  }

  await prisma.boardMember.create({ data: { boardId: board.id, userId: target.id, role } });
  await recordAudit({
    boardId: board.id,
    actorId,
    action: 'MEMBER_ADDED',
    entityType: 'member',
    entityId: target.id,
    metadata: { email, role },
  });

  res.status(201).json({ member: { user: target, role } });
});

boardsRouter.patch('/:boardId/members/:userId', requireBoardAccess('OWNER'), async (req, res) => {
  const { role } = parseBody(changeRoleSchema, req);
  const { board } = currentBoardAccess(res);
  const actorId = currentUserId(res);
  const memberUserId = req.params.userId as string;

  if (memberUserId === board.ownerId) {
    throw new HttpError(400, 'CANNOT_CHANGE_OWNER', 'The board owner role cannot be changed');
  }

  const membership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: board.id, userId: memberUserId } },
    select: {
      role: true,
      user: { select: { id: true, email: true, name: true } },
    },
  });
  if (!membership) {
    throw new HttpError(404, 'MEMBER_NOT_FOUND', 'User is not a member of this board');
  }

  await prisma.boardMember.update({
    where: { boardId_userId: { boardId: board.id, userId: memberUserId } },
    data: { role },
  });
  await recordAudit({
    boardId: board.id,
    actorId,
    action: 'MEMBER_ROLE_CHANGED',
    entityType: 'member',
    entityId: memberUserId,
    metadata: { oldRole: membership.role, role },
  });

  res.json({ member: { user: membership.user, role } });
});

boardsRouter.delete('/:boardId/members/:userId', requireBoardAccess('OWNER'), async (req, res) => {
  const { board } = currentBoardAccess(res);
  const actorId = currentUserId(res);
  const memberUserId = req.params.userId as string;

  if (memberUserId === board.ownerId) {
    throw new HttpError(400, 'CANNOT_REMOVE_OWNER', 'The board owner cannot be removed');
  }

  const membership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: board.id, userId: memberUserId } },
    select: { userId: true },
  });
  if (!membership) {
    throw new HttpError(404, 'MEMBER_NOT_FOUND', 'User is not a member of this board');
  }

  await prisma.boardMember.delete({
    where: { boardId_userId: { boardId: board.id, userId: memberUserId } },
  });
  await recordAudit({
    boardId: board.id,
    actorId,
    action: 'MEMBER_REMOVED',
    entityType: 'member',
    entityId: memberUserId,
  });

  res.status(204).end();
});

boardsRouter.patch('/:boardId', requireBoardAccess('EDITOR'), async (req, res) => {
  const data = parseBody(updateBoardSchema, req);
  const { board } = currentBoardAccess(res);
  const actorId = currentUserId(res);

  const patch: Prisma.BoardUpdateInput = {};
  if (data.title !== undefined) {
    patch.title = data.title;
  }
  if (data.description !== undefined) {
    patch.description = data.description;
  }

  if (Object.keys(patch).length === 0) {
    res.json({ board: boardJson(board) });
    return;
  }

  const updated = await prisma.board.update({
    where: { id: board.id },
    data: patch,
    select: boardSummarySelect,
  });
  await recordAudit({
    boardId: board.id,
    actorId,
    action: 'BOARD_UPDATED',
    entityType: 'board',
    entityId: board.id,
    metadata: { fields: Object.keys(patch) },
  });

  res.json({ board: boardJson(updated) });
});

boardsRouter.delete('/:boardId', requireBoardAccess('OWNER'), async (_req, res) => {
  const { board } = currentBoardAccess(res);

  // Deleting the board cascades members, columns, tasks, comments, and the
  // board's audit history by design (AuditEvent.boardId is onDelete: Cascade).
  await prisma.board.delete({ where: { id: board.id } });
  res.status(204).end();
});

// Columns and tasks live under /api/boards/:boardId (see board-content.ts).
boardsRouter.use('/:boardId', boardContentRouter);
