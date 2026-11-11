import { describe, expect, it } from 'vitest';

import { envSchema } from './env.schema.js';

const env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/gym_app_test',
  JWT_SECRET: 'integration-test-secret',
  JWT_ISSUER: 'http://localhost:3000',
  APP_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000',
};
const token = 'r'.repeat(43);

describe('HTTP metrics env safety', () => {
  it('disables internal metrics by default', () => {
    const result = envSchema.safeParse(env);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.HTTP_METRICS_ENABLED).toBe(false);
      expect(result.data.HTTP_METRICS_TOKEN).toBeUndefined();
    }
  });

  it('requires a separate long token whenever scraping is enabled', () => {
    for (const value of [undefined, '', 'short', 'a'.repeat(42), 'a'.repeat(43) + '$']) {
      expect(envSchema.safeParse({
        ...env,
        HTTP_METRICS_ENABLED: 'true',
        HTTP_METRICS_TOKEN: value,
      }).success).toBe(false);
    }
    const result = envSchema.safeParse({
      ...env, HTTP_METRICS_ENABLED: 'true', HTTP_METRICS_TOKEN: token,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.HTTP_METRICS_ENABLED).toBe(true);
  });

  it('rejects truthy aliases and unexpected env flag values', () => {
    for (const value of ['1', 'yes', 'TRUE', true]) {
      expect(envSchema.safeParse({
        ...env, HTTP_METRICS_ENABLED: value,
      }).success).toBe(false);
    }
  });
});
