import type { Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { HttpError } from './http-error.js';

export const REFRESH_COOKIE = 'refreshToken';

interface TokenPayload {
  type: 'access' | 'refresh';
  sub: string;
}

const refreshCookieBase = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.isProd,
  path: '/api/auth',
};

const REFRESH_COOKIE_OPTIONS = {
  ...refreshCookieBase,
  maxAge: env.refreshTokenTtlSeconds * 1000,
};

export function signAccessToken(userId: string): string {
  const payload: TokenPayload = { type: 'access', sub: userId };
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.accessTokenTtlSeconds });
}

export function signRefreshToken(userId: string): string {
  const payload: TokenPayload = { type: 'refresh', sub: userId };
  return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: env.refreshTokenTtlSeconds });
}

function verifyToken(token: string, expected: TokenPayload['type']): string {
  const secret = expected === 'access' ? env.jwtAccessSecret : env.jwtRefreshSecret;
  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload & Partial<TokenPayload>;
    if (payload.type !== expected || typeof payload.sub !== 'string') {
      throw new Error('Unexpected token type');
    }
    return payload.sub;
  } catch {
    const message =
      expected === 'access' ? 'Invalid or expired token' : 'Invalid or expired session';
    throw new HttpError(401, 'UNAUTHORIZED', message);
  }
}

export function verifyAccessToken(token: string): string {
  return verifyToken(token, 'access');
}

export function verifyRefreshToken(token: string): string {
  return verifyToken(token, 'refresh');
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, REFRESH_COOKIE_OPTIONS);
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, refreshCookieBase);
}
