import { randomUUID } from 'node:crypto';

import { PasswordHasher } from '@nestjs/authentication';
import {
  StandardSchemaValidationPipe,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Mailer } from '@nestjs/mail';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getTrustedProxies } from '../../src/common/config/proxy.config.js';
import { PrismaService } from '../../src/infra/database/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  APP_URL: process.env.APP_URL,
  JWT_SECRET: process.env.JWT_SECRET,
};

describe('Per-account recovery throttling (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId = '';
  const email = `recovery-account-${randomUUID()}@example.test`;
  const unknownEmail = `unknown-recovery-${randomUUID()}@example.test`;
  const mailer = { send: vi.fn(async () => undefined) };

  async function forgot(address: string, ip: string) {
    return request(app.getHttpServer())
      .post('/auth/password-reset/forgot')
      .set('X-Forwarded-For', ip)
      .send({ email: address });
  }

  beforeAll(async () => {
    useTestDatabase();
    process.env.APP_URL ||= 'http://localhost:3000';
    if (
      !process.env.JWT_SECRET ||
      Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32
    ) {
      process.env.JWT_SECRET = randomUUID() + randomUUID();
    }

    const { AppModule } = await import('../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(Mailer)
      .useValue(mailer)
      .compile();

    app = moduleRef.createNestApplication();
    // Simulate distinct real client IPs arriving via a trusted local proxy.
    // The 3/min IP throttler must not hide the independent 5/hour email rule.
    app.getHttpAdapter().getInstance().set(
      'trust proxy',
      getTrustedProxies('loopback'),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
      new StandardSchemaValidationPipe(),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const hasher = app.get(PasswordHasher);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hasher.hash('StrongPassword123!'),
      },
      select: { id: true },
    });
    userId = user.id;
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma && userId) {
        await prisma.user.deleteMany({ where: { id: userId } });
      }
      await app?.close();
    } finally {
      for (const key of ['DATABASE_URL', 'APP_URL', 'JWT_SECRET'] as const) {
        if (originalEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = originalEnv[key];
        }
      }
    }
  }, 20_000);

  it('blocks an email after five requests across different IPs and normalized spellings', async () => {
    mailer.send.mockClear();

    for (let i = 0; i < 5; i++) {
      const address = i % 2 === 0
        ? `  ${email.toUpperCase()}  `
        : email;
      const accepted = await forgot(address, `203.0.113.${i + 1}`);
      expect(accepted.status).toBe(202);
      expect(accepted.body).toEqual({});
      expect(accepted.headers['cache-control']).toBe('no-store');
    }

    await vi.waitFor(() => {
      expect(mailer.send).toHaveBeenCalledTimes(5);
    }, { timeout: 5_000, interval: 25 });
    const saved = await prisma.emailToken.count({
      where: { userId, purpose: 'password-reset' },
    });
    expect(saved).toBe(5);

    const blocked = await forgot(email, '203.0.113.10');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(mailer.send).toHaveBeenCalledTimes(5);
    expect(
      await prisma.emailToken.count({
        where: { userId, purpose: 'password-reset' },
      }),
    ).toBe(saved);
  });

  it('applies the same anonymous 202/429 rule to unknown email addresses', async () => {
    mailer.send.mockClear();

    for (let i = 0; i < 5; i++) {
      const address = i % 2 === 0
        ? unknownEmail.toUpperCase()
        : ` ${unknownEmail} `;
      const accepted = await forgot(address, `198.51.100.${i + 1}`);
      expect(accepted.status).toBe(202);
      expect(accepted.body).toEqual({});
      expect(accepted.headers['cache-control']).toBe('no-store');
    }

    const blocked = await forgot(unknownEmail, '198.51.100.10');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(mailer.send).not.toHaveBeenCalled();
    expect(await prisma.user.count({ where: { email: unknownEmail } })).toBe(0);
  });
});
