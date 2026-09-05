import type { AuditAction, Prisma } from '@prisma/client';

import { prisma } from './prisma.js';
import { publishToBoard } from './realtime.js';

/**
 * Shape of a realtime change event broadcast to a board's live subscribers.
 * Every audited mutation produces one; the client uses it to decide what to
 * re-sync (a comment event refreshes the open task's thread, everything else
 * refreshes the board).
 */
export interface BoardChangeMessage {
  id: string;
  // String, not AuditAction: broadcasts may carry ephemeral actions that are
  // deliberately not persisted to the audit table (e.g. COMMENT_DELETED).
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Prisma.JsonValue;
  actorId: string;
  createdAt: Date;
}

export function broadcastBoardChange(
  boardId: string,
  message: Omit<BoardChangeMessage, 'createdAt'> & { createdAt?: Date },
): void {
  publishToBoard(boardId, 'change', {
    ...message,
    createdAt: message.createdAt ?? new Date(),
  });
}

export async function recordAudit(params: {
  boardId: string;
  actorId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  const event = await prisma.auditEvent.create({
    data: {
      boardId: params.boardId,
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      metadata: params.metadata,
    },
  });

  // Fire-and-forget broadcast to this board's live viewers. Subscribers only
  // need the audit facts, not the full actor object (their next fetch pulls
  // fresh data), so the payload stays small. Never let a socket hiccup fail
  // the mutation that just succeeded.
  broadcastBoardChange(params.boardId, {
    id: event.id,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    metadata: event.metadata,
    actorId: event.actorId,
    createdAt: event.createdAt,
  });
}
