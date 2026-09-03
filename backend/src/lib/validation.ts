import type { Request } from 'express';
import { z } from 'zod';

import { HttpError } from './http-error.js';

export function parseBody<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request body',
    );
  }
  return result.data;
}
