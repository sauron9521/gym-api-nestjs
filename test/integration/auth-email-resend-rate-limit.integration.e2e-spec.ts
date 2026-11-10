import { randomUUID } from 'node:crypto';

import { PasswordHasher } from '@nestjs/authentication';
import type { INestApplication } from '@nestjs/common';
import { Mailer } from '@nestjs/mail';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../../src/infra/database/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  APP_URL: process.env.APP_URL,
  JWT_SECRET: process.env.JWT_SECRET,
};

const password = 'StrongPassword123!';

describe('Email verification resend throttling (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId = '';
  let cookie = '';

  const email = \`resend-throttle-\${randomUUID()}@example.test\`;
  const mailer = { send: vi.fn().mockResolvedValue(undefined) };

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
    await app.init();
    prisma = app.get(PrismaService);

    const hasher = app.get(PasswordHasher);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hasher.hash(password),
      },
      select: { id: true },
    });
    userId = user.id;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const rawCookies = login.headers['set-cookie'];
    const cookies: string[] = Array.isArray(rawCookies)
      ? rawCookies
      : typeof rawCookies === 'string'
        ? [rawCookies]
        : [];
    const currentCookie = cookies
      .map((value) => value.split(';', 1)[0] ?? '')
      .find((value) => value.startsWith('__Host-sid='));
    if (!currentCookie) {
      throw new Error('Expected a session cookie after login');
    }
    cookie = currentCookie;
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

  it('permits only three authenticated resends and rejects a fourth before email/token creation', async () => {
    mailer.send.mockClear();

    for (let i = 0; i < 3; i++) {
      const response = await request(app.getHttpServer())
        .post('/auth/email/verification')
        .set('Cookie', cookie)
        .expect(202);
      expect(response.body).toEqual({});
      expect(response.headers['cache-control']).toBe('no-store');
    }

    expect(mailer.send).toHaveBeenCalledTimes(3);
    const tokenCount = await prisma.emailToken.count({ where: { userId } });
    expect(tokenCount).toBe(3);

    const blocked = await request(app.getHttpServer())
      .post('/auth/email/verification')
      .set('Cookie', cookie)
      .expect(429);
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(mailer.send).toHaveBeenCalledTimes(3);
    expect(await prisma.emailToken.count({ where: { userId } })).toBe(
      tokenCount,
    );

    // Rate limiting a resend must not invalidate the authenticated session.
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', cookie)
      .expect(200);
  });
});
