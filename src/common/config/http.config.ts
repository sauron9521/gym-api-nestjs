import type { AppEnv } from './env.schema.js';

/** CORS_ORIGINS has already been validated as origin-only URLs by Zod. */
export function getCorsOrigins(origins: AppEnv['CORS_ORIGINS']): string[] {
  return origins.split(',').map((origin) => origin.trim());
}
