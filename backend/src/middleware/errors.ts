import type { NextFunction, Request, Response } from 'express';

import { HttpError } from '../lib/http-error.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  const syntaxError = err as { status?: number };
  if (err instanceof SyntaxError && syntaxError.status === 400) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}
