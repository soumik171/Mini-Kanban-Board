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
  const bodyParserError = err as { status?: number; type?: string };
  if (bodyParserError.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
    return;
  }
  if (
    bodyParserError.status === 415 ||
    bodyParserError.type === 'encoding.unsupported' ||
    bodyParserError.type === 'charset.unsupported'
  ) {
    res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported media type or charset' } });
    return;
  }
  if (err instanceof SyntaxError && bodyParserError.status === 400) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}
