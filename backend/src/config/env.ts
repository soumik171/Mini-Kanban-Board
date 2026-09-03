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
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:3000',
  jwtAccessSecret: secret('JWT_ACCESS_SECRET', 'dev-only-access-secret-change-me'),
  jwtRefreshSecret: secret('JWT_REFRESH_SECRET', 'dev-only-refresh-secret-change-me'),
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 7 * 24 * 60 * 60,
} as const;
