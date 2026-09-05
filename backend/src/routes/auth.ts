import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { env } from '../config/env.js';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { subscribeToBoard } from '../lib/realtime.js';
import {
  clearRefreshCookie,
  REFRESH_COOKIE,
  setRefreshCookie,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../lib/tokens.js';
import { parseBody } from '../lib/validation.js';
import { currentUserId, requireAuth } from '../middleware/auth.js';

const BCRYPT_COST = 12;

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

export const authRouter = Router();

function publicUser(user: { id: string; email: string; name: string }) {
  return { id: user.id, email: user.email, name: user.name };
}

function setSession(res: Response, userId: string): void {
  setRefreshCookie(res, signRefreshToken(userId));
}

function assertSameOrigin(req: Request): void {
  const origin = req.headers.origin;
  if (origin && origin !== env.clientOrigin) {
    throw new HttpError(403, 'FORBIDDEN', 'Cross-origin request rejected');
  }
}

authRouter.post('/register', async (req, res) => {
  const { email, name, password } = parseBody(registerSchema, req);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new HttpError(400, 'EMAIL_IN_USE', 'An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  let user: { id: string; email: string; name: string };
  try {
    user = await prisma.user.create({
      data: { email, name, passwordHash },
      select: { id: true, email: true, name: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(400, 'EMAIL_IN_USE', 'An account with this email already exists');
    }
    throw err;
  }

  setSession(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = parseBody(loginSchema, req);

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user && (await bcrypt.compare(password, user.passwordHash));
  if (!valid || !user) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  setSession(res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post('/refresh', (req, res) => {
  assertSameOrigin(req);

  const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? '';
  if (!token) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Missing refresh token');
  }

  const userId = verifyRefreshToken(token);
  setRefreshCookie(res, signRefreshToken(userId));
  res.json({ accessToken: signAccessToken(userId) });
});

authRouter.post('/logout', (req, res) => {
  assertSameOrigin(req);
  clearRefreshCookie(res);
  res.status(204).end();
});

// Live board stream (Server-Sent Events). EventSource cannot send an
// Authorization header, and the refresh cookie is deliberately path-scoped to
// /api/auth - so the stream lives here, authenticating via that cookie.
// Subscribers receive `change` events broadcast by recordAudit whenever any
// member mutates the board, plus a `connected` event on handshake and a
// `deleted` event if the board itself is removed.
authRouter.get('/stream', async (req, res) => {
  const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? '';
  if (!token) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Missing refresh token');
  }
  const userId = verifyRefreshToken(token);

  const boardId = req.query.boardId;
  if (typeof boardId !== 'string' || boardId.length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'boardId query parameter is required');
  }

  // Only board members may watch a board's stream.
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { id: true, ownerId: true },
  });
  if (!board) {
    throw new HttpError(404, 'BOARD_NOT_FOUND', 'Board not found');
  }
  if (board.ownerId !== userId) {
    const member = await prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId, userId } },
      select: { id: true },
    });
    if (!member) {
      throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this board');
    }
  }

  // All checks pass: commit to the streaming response.
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Ask proxies (and the Next.js dev rewrite) not to buffer the stream.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: connected\ndata: ${JSON.stringify({ boardId })}\n\n`);

  // Keep the connection alive past idle proxy timeouts.
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  const unsubscribe = subscribeToBoard(boardId, res);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

authRouter.get('/me', requireAuth, async (_req, res) => {
  const userId = currentUserId(res);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Account no longer exists');
  }
  res.json({ user: publicUser(user) });
});
