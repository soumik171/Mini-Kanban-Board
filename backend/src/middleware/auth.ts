import type { NextFunction, Request, Response } from 'express';

import { HttpError } from '../lib/http-error.js';
import { verifyAccessToken } from '../lib/tokens.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const match = req.headers.authorization?.match(/^Bearer (.+)$/);
  if (!match) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  res.locals.userId = verifyAccessToken(match[1] ?? '');
  next();
}

export function currentUserId(res: Response): string {
  const userId = res.locals.userId as string | undefined;
  if (!userId) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  return userId;
}
