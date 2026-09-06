import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';

import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { boardsRouter } from './routes/boards.js';

const rateLimitWindowMs = 15 * 60 * 1000;

const rateLimitedBody = {
  error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
};

export function buildApp(): express.Express {
  const app = express();

  // Limiters are created per app instance so tests spinning up multiple
  // servers get independent budgets.
  // Stricter cap on auth routes to blunt password brute force and token guessing.
  const authLimiter = rateLimit({
    windowMs: rateLimitWindowMs,
    limit: env.authRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: rateLimitedBody,
  });

  // General cap on the whole API surface.
  const apiLimiter = rateLimit({
    windowMs: rateLimitWindowMs,
    limit: env.apiRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: rateLimitedBody,
  });

  app.disable('x-powered-by');

  if (env.trustProxy) {
    // Key rate limits on the real client IP when behind a reverse proxy.
    app.set('trust proxy', 1);
  }

  // Strict CORS allowlist: only the configured frontend origin may read
  // responses with credentials (the refresh cookie is HttpOnly). The
  // callback form is used deliberately - a plain string origin is echoed
  // unconditionally, while this reflects it only for allowed origins.
  // Normalize the incoming origin by stripping any trailing slash so the
  // comparison matches even when CLIENT_ORIGIN was entered with one.
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, origin?.replace(/\/+$/, '') === env.clientOrigin),
      credentials: true,
    }),
  );

  // Security headers: nosniff, framing, referrer policy, HSTS, and friends.
  app.use(helmet());

  // Rate limits run before body parsing so throttled clients never cost
  // parsing work; /health stays unlimited. The strict auth limiter guards the
  // credential/token endpoints only - /me and the realtime /stream verify
  // signed tokens or memberships instead of guessing secrets, and a long-lived
  // stream must never be able to exhaust (or be exhausted by) the login
  // budget via EventSource auto-reconnects.
  app.use('/api', apiLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth/refresh', authLimiter);

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