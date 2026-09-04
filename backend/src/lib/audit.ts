import type { AuditAction, Prisma } from '@prisma/client';

import { prisma } from './prisma.js';

export async function recordAudit(params: {
  boardId: string;
  actorId: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      boardId: params.boardId,
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      metadata: params.metadata,
    },
  });
}
