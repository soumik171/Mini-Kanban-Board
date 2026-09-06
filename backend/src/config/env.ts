import 'dotenv/config';

const DEFAULT_PORT = 4000;

function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: "${value}"`);
  }
  return port;
}

function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid ${name} value: "${value}"`);
  }
  return n;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';

function secret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProd) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return devFallback;
}

export const env = {
  nodeEnv,
  isProd,
  // Vitest injects PORT=0 into workers; tests bind their own ephemeral ports.
  port: nodeEnv === 'test' ? DEFAULT_PORT : parsePort(process.env.PORT),
  // Normalize: strip trailing slash so comparisons work regardless of how the
  // env var was entered (browsers send Origin without a trailing slash).
  clientOrigin:
    (process.env.CLIENT_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, ''),
  jwtAccessSecret: secret('JWT_ACCESS_SECRET', 'dev-only-access-secret-change-me'),
  jwtRefreshSecret: secret('JWT_REFRESH_SECRET', 'dev-only-refresh-secret-change-me'),
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 7 * 24 * 60 * 60,
  // Requests per 15-minute window, keyed by IP. Tune via env for production.
  authRateLimitMax: positiveInt('AUTH_RATE_LIMIT_MAX', process.env.AUTH_RATE_LIMIT_MAX, 100),
  apiRateLimitMax: positiveInt('API_RATE_LIMIT_MAX', process.env.API_RATE_LIMIT_MAX, 1000),
  // Set TRUST_PROXY=1 when running behind a reverse proxy so rate limits key
  // on the real client IP instead of the proxy's.
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
} as const;
