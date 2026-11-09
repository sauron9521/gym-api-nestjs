import { z } from 'zod';

import { isTrustedProxyList } from './proxy.config.js';

const emptyToUndefined = (value: unknown) =>
  value === '' ? undefined : value;

const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional(),
);

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

function isRedisUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'redis:' || url.protocol === 'rediss:') &&
      Boolean(url.hostname) &&
      !url.hash &&
      !url.search &&
      (url.pathname === '' || url.pathname === '/' || (url.pathname.startsWith('/') && /^[0-9]{1,2}$/.test(url.pathname.slice(1))))
    );
  } catch {
    return false;
  }
}

function isSmtpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'smtp:' || url.protocol === 'smtps:') &&
      Boolean(url.hostname) &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isMailFrom(value: string): boolean {
  if (/[\r\n]/.test(value)) return false;
  const address = value.includes('<')
    ? /^[^<>]+ <([^<>\s]+)>$/.exec(value)?.[1]
    : value;
  return typeof address === 'string' &&
    /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address);
}

function getOrigins(value: string): string[] | null {
  const origins = value.split(',').map((item) => item.trim());
  if (origins.some((origin) => !origin || !isPublicHttpUrl(origin))) {
    return null;
  }
  for (const origin of origins) {
    if (new URL(origin).origin !== origin) return null;
  }
  return origins;
}

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.string().min(1)
    .refine(isPostgresUrl, 'Must be a PostgreSQL connection URL'),
  JWT_SECRET: z.string().min(1),
  JWT_ISSUER: z.string().min(1)
    .refine(isPublicHttpUrl, 'Must be an HTTP(S) URL without credentials'),
  APP_URL: z.string().min(1)
    .refine(isPublicHttpUrl, 'Must be an HTTP(S) URL without credentials'),
  CORS_ORIGINS: z.string().min(1)
    .refine((value) => getOrigins(value) !== null, 'Must be a comma-separated list of HTTP(S) origins'),
  PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(65535).default(3000),
  ),
  SMTP_URL: z.preprocess(
    emptyToUndefined,
    z.string().trim().refine(isSmtpUrl, 'Must be an smtp:// or smtps:// URL').optional(),
  ),
  MAIL_FROM: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(254)
      .refine(isMailFrom, 'Must be an email address or Display Name <email>').optional(),
  ),
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose']).default('log'),
  ),
  ENABLE_OPENAPI: z.enum(['true', 'false']).default('false')
    .transform((value) => value === 'true'),
  AVATAR_STORAGE_DIR: optionalString,
  REDIS_URL: z.preprocess(emptyToUndefined,
    z.string().trim().refine(isRedisUrl, 'Must be a redis:// or rediss:// URL').optional(),
  ),
  TRUSTED_PROXY_CIDRS: z.preprocess(emptyToUndefined,
    z.string().trim().refine(isTrustedProxyList, 'Must be trusted IPs, CIDRs or named local subnets').optional(),
  ),
});

export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;

  for (const key of ['APP_URL', 'JWT_ISSUER'] as const) {
    if (new URL(env[key]).protocol !== 'https:') {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'HTTPS is required in production',
      });
    }
  }

  if (Buffer.byteLength(env.JWT_SECRET, 'utf8') < 32 ||
      new Set(env.JWT_SECRET).size < 8) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'Use a randomly generated secret of at least 32 bytes',
    });
  }

  if (!env.SMTP_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['SMTP_URL'],
      message: 'SMTP transport is required in production',
    });
  } else if (new URL(env.SMTP_URL).protocol !== 'smtps:') {
    ctx.addIssue({
      code: 'custom',
      path: ['SMTP_URL'],
      message: 'Use smtps:// for encrypted production SMTP',
    });
  }

  if (!env.MAIL_FROM) {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_FROM'],
      message: 'MAIL_FROM is required in production',
    });
  }

  const origins = getOrigins(env.CORS_ORIGINS);
  if (origins?.some((origin) => new URL(origin).protocol !== 'https:')) {
    ctx.addIssue({
      code: 'custom',
      path: ['CORS_ORIGINS'],
      message: 'All production origins must use HTTPS',
    });
  }
});

export type AppEnv = z.infer<typeof envSchema>;
