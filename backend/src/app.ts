import cookieParser from 'cookie-parser';
import express from 'express';

import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { boardsRouter } from './routes/boards.js';

export function buildApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/boards', boardsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
