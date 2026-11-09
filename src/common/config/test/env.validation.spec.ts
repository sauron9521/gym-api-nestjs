import { describe, expect, it } from 'vitest';
import { validateEnv } from '../env.validation.js';

const validDev = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/gym',
  JWT_SECRET: 'test-secret',
  JWT_ISSUER: 'http://localhost:3000',
  APP_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001',
};

const validProd = {
  ...validDev,
  NODE_ENV: 'production',
  JWT_SECRET: '7tQzM8veL3hrC9spF6jW2baX5kYeP4nB',
  JWT_ISSUER: 'https://api.example.test',
  APP_URL: 'https://app.example.test',
  CORS_ORIGINS: 'https://app.example.test',
  SMTP_URL: 'smtps://mailer.example.test:465',
  MAIL_FROM: 'Gym API <no-reply@example.test>',
};

describe('validateEnv', () => {
  it('accepts development and supplies defaults', () => {
    const env = validateEnv(validDev);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.ENABLE_OPENAPI).toBe(false);
    expect(env.LOG_LEVEL).toBe('log');
  });

  it('normalizes optional log level and rejects unsupported values', () => {
    expect(validateEnv({ ...validDev, LOG_LEVEL: 'debug' }).LOG_LEVEL).toBe('debug');
    expect(validateEnv({ ...validDev, LOG_LEVEL: '' }).LOG_LEVEL).toBe('log');
    expect(() => validateEnv({ ...validDev, LOG_LEVEL: 'trace' })).toThrow(
      'Invalid environment configuration: LOG_LEVEL',
    );
  });

  it('accepts test configuration without SMTP', () => {
    expect(validateEnv({ ...validDev, NODE_ENV: 'test' }).SMTP_URL)
      .toBeUndefined();
  });

  it('accepts production with encrypted SMTP', () => {
    expect(validateEnv(validProd).SMTP_URL)
      .toBe(validProd.SMTP_URL);
  });

  it('parses optional values and booleans', () => {
    const env = validateEnv({
      ...validDev,
      PORT: '4000',
      SMTP_URL: '',
      MAIL_FROM: '',
      ENABLE_OPENAPI: 'true',
    });
    expect(env.PORT).toBe(4000);
    expect(env.ENABLE_OPENAPI).toBe(true);
    expect(env.MAIL_FROM).toBeUndefined();
  });

  it.each([
    ['missing DATABASE_URL', { DATABASE_URL: undefined }],
    ['invalid database protocol', { DATABASE_URL: 'https://db.example.test' }],
    ['missing JWT_SECRET', { JWT_SECRET: '' }],
    ['invalid PORT', { PORT: '70000' }],
    ['invalid OPENAPI toggle', { ENABLE_OPENAPI: 'yes' }],
    ['wildcard CORS', { CORS_ORIGINS: '*' }],
    ['CORS origin with path', { CORS_ORIGINS: 'https://app.example.test/path' }],
    ['URL credentials', { APP_URL: 'https://user:pw@app.example.test' }],
    ['invalid SMTP protocol', { SMTP_URL: 'https://smtp.example.test' }],
    ['MAIL_FROM header injection', { MAIL_FROM: 'a@example.test\r\nBcc: bad@example.test' }],
  ])('rejects %s', (_label, override) => {
    expect(() => validateEnv({ ...validDev, ...override })).toThrow(
      'Invalid environment configuration',
    );
  });

  it.each([
    ['weak secret', { JWT_SECRET: 'a'.repeat(40) }],
    ['HTTP app URL', { APP_URL: 'http://app.example.test' }],
    ['HTTP issuer', { JWT_ISSUER: 'http://api.example.test' }],
    ['HTTP origin', { CORS_ORIGINS: 'http://app.example.test' }],
    ['missing SMTP', { SMTP_URL: undefined }],
    ['unencrypted SMTP', { SMTP_URL: 'smtp://mailer.example.test:587' }],
    ['missing sender', { MAIL_FROM: undefined }],
  ])('rejects unsafe production %s', (_label, override) => {
    expect(() => validateEnv({ ...validProd, ...override })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('never exposes credential values in validation diagnostics', () => {
    const secret = 'secret-smtp-password';
    expect(() =>
      validateEnv({
        ...validProd,
        SMTP_URL: 'smtp://user:' + secret + '@mailer.example.test:587',
      }),
    ).toThrowError(/SMTP_URL/);
    try {
      validateEnv({ ...validProd, SMTP_URL: 'smtp://user:' + secret + '@mailer.example.test:587' });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
