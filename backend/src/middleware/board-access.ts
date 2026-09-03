import type { NextFunction, Request, Response } from 'express';
import type { Prisma, Role } from '@prisma/client';

import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { currentUserId } from './auth.js';

const ROLE_RANK: Record<Role, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

const ownerSelect = { id: true, email: true, name: true } as const;

export type BoardWithOwner = Prisma.BoardGetPayload<{
  include: { owner: { select: typeof ownerSelect } };
}>;

export interface BoardAccess {
  board: BoardWithOwner;
  role: Role;
}

/**
 * Loads a board and resolves the requesting user's effective role:
 * the canonical owner is always OWNER; everyone else gets their
 * BoardMember role. Throws 404/403 on missing board or access.
 */
export async function resolveBoardAccess(req: Request, res: Response): Promise<BoardAccess> {
  const boardId = req.params.boardId as string | undefined;
  const userId = currentUserId(res);

  const board = await prisma.board.findUnique({
    where: { id: boardId ?? '' },
    include: { owner: { select: ownerSelect } },
  });
  if (!board) {
    throw new HttpError(404, 'BOARD_NOT_FOUND', 'Board not found');
  }

  if (board.ownerId === userId) {
    return { board, role: 'OWNER' };
  }

  const membership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: board.id, userId } },
  });
  if (!membership) {
    throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this board');
  }

  return { board, role: membership.role };
}

/**
 * Guard factory for board-scoped routes. With no required role it admits any
 * member (VIEWER or above); pass a role (e.g. 'OWNER') to restrict further.
 * Stores the resolved access on res.locals for the route handler.
 */
export function requireBoardAccess(requiredRole?: Role) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const access = await resolveBoardAccess(req, res);
    if (requiredRole && ROLE_RANK[access.role] < ROLE_RANK[requiredRole]) {
      throw new HttpError(
        403,
        'FORBIDDEN',
        `This action requires the ${requiredRole} role on this board`,
      );
    }
    res.locals.boardAccess = access;
    next();
  };
}

export function currentBoardAccess(res: Response): BoardAccess {
  const access = res.locals.boardAccess as BoardAccess | undefined;
  if (!access) {
    throw new Error('currentBoardAccess called before requireBoardAccess middleware');
  }
  return access;
}
