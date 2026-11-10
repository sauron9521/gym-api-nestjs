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
const password = 'StrongPassword123!';

describe('Verification resend per-user throttle (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdIds: string[] = [];
  const mailer = { send: vi.fn(async () => undefined) };

  function sessionCookie(headers: string | string[] | undefined): string {
    const cookies = Array.isArray(headers) ? headers : headers ? [headers] : [];
    const value = cookies.map((header) => header.split(';', 1)[0] ?? '')
      .find((cookie) => cookie.startsWith('__Host-sid='));
    if (!value) throw new Error('Expected authenticated session cookie');
    return value;
  }

  async function account() {
    const email = `resend-user-${randomUUID()}@example.test`;
    const hasher = app.get(PasswordHasher);
    const user = await prisma.user.create({
      data: { email, passwordHash: await hasher.hash(password) },
      select: { id: true },
    });
    createdIds.push(user.id);
    return { id: user.id, email };
  }

  async function login(email: string, ip: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password })
      .expect(200);
    return sessionCookie(response.headers['set-cookie']);
  }

  function resend(cookie: string, ip: string) {
    return request(app.getHttpServer())
      .post('/auth/email/verification')
      .set('X-Forwarded-For', ip)
      .set('Cookie', cookie);
  }

  beforeAll(async () => {
    useTestDatabase();
    process.env.APP_URL ||= 'http://localhost:3000';
    if (!process.env.JWT_SECRET ||
        Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32) {
      process.env.JWT_SECRET = randomUUID() + randomUUID();
    }

    const { AppModule } = await import('../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Mailer)
      .useValue(mailer)
      .compile();

    app = moduleRef.createNestApplication();
    // Only trusted loopback can supply the simulated real client IP.
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
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma && createdIds.length) {
        await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
      }
      await app?.close();
    } finally {
      for (const key of ['DATABASE_URL', 'APP_URL', 'JWT_SECRET'] as const) {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
      }
    }
  }, 20_000);

  it('shares five resends across sessions and IPs, blocks the sixth without side effects', async () => {
    const user = await account();
    const first = await login(user.email, '192.0.2.101');
    const second = await login(user.email, '192.0.2.102');
    mailer.send.mockClear();

    for (let index = 0; index < 5; index++) {
      const accepted = await resend(
        index % 2 === 0 ? first : second,
        `203.0.113.${index + 1}`,
      ).expect(202);
      expect(accepted.body).toEqual({});
      expect(accepted.headers['cache-control']).toBe('no-store');
    }

    expect(mailer.send).toHaveBeenCalledTimes(5);
    expect(await prisma.emailToken.count({ where: { userId: user.id } })).toBe(5);

    const blocked = await resend(second, '203.0.113.10').expect(429);
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(mailer.send).toHaveBeenCalledTimes(5);
    expect(await prisma.emailToken.count({ where: { userId: user.id } })).toBe(5);

    // User-scoped counters do not affect another unverified account.
    const other = await account();
    const otherCookie = await login(other.email, '192.0.2.103');
    await resend(otherCookie, '203.0.113.20').expect(202);
    expect(await prisma.emailToken.count({ where: { userId: other.id } })).toBe(1);

    for (const cookie of [first, second]) {
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Cookie', cookie)
        .expect(200);
    }
  });

  it('preserves unauthorized 401 and verified-user 409 without sending a message', async () => {
    const denied = await request(app.getHttpServer())
      .post('/auth/email/verification')
      .set('X-Forwarded-For', '203.0.113.30')
      .expect(401);
    expect(denied.headers['cache-control']).toBe('no-store');

    const verified = await account();
    await prisma.user.update({
      where: { id: verified.id },
      data: { emailVerified: true },
    });
    const cookie = await login(verified.email, '192.0.2.110');
    mailer.send.mockClear();

    const conflict = await resend(cookie, '203.0.113.31').expect(409);
    expect(conflict.headers['cache-control']).toBe('no-store');
    expect(mailer.send).not.toHaveBeenCalled();
    expect(await prisma.emailToken.count({ where: { userId: verified.id } })).toBe(0);
  });
});
