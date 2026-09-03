import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { env } from '../config/env.js';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
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
