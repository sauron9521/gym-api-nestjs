import { randomUUID } from 'node:crypto';

import { PasswordHasher } from '@nestjs/authentication';
import {
  StandardSchemaValidationPipe,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Mailer } from '@nestjs/mail';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DistributedThrottlerStorage } from '../../src/common/rate-limit/distributed-throttler.storage.js';
import { PrismaService } from '../../src/infra/database/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

const testRedisUrl = process.env.TEST_REDIS_URL;
const redisDescribe = testRedisUrl ? describe : describe.skip;

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  APP_URL: process.env.APP_URL,
  JWT_SECRET: process.env.JWT_SECRET,
};
const password = 'StrongPassword123!';

redisDescribe('Account throttle Redis client outage and recovery (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: DistributedThrottlerStorage;
  let redisClient: Redis;
  const email = 'rate-recovery-' + randomUUID() + '@example.test';
  let userId = '';
  let cookie = '';
  const mailer = { send: vi.fn(async () => undefined) };

  function sessionCookie(headers: string | string[] | undefined): string {
    const raw = Array.isArray(headers) ? headers : headers ? [headers] : [];
    const value = raw
      .map((header) => header.split(';', 1)[0] ?? '')
      .find((candidate) => candidate.startsWith('__Host-sid='));
    if (!value) throw new Error('Expected authenticated session cookie');
    return value;
  }

  function forgot(address = email) {
    return request(app.getHttpServer())
      .post('/auth/password-reset/forgot')
      .send({ email: address });
  }

  function resend() {
    return request(app.getHttpServer())
      .post('/auth/email/verification')
      .set('Cookie', cookie);
  }

  function assertPrivateResponse(
    status: number,
    response: {
      status: number;
      headers: Record<string, string | string[] | undefined>;
      body: unknown;
    },
  ): void {
    expect(response.status).toBe(status);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toContain('redis://');
    expect(JSON.stringify(response.body)).not.toContain(email);
  }

  beforeAll(async () => {
    useTestDatabase();
    process.env.APP_URL ||= 'http://localhost:3000';
    if (!process.env.JWT_SECRET ||
        Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32) {
      process.env.JWT_SECRET = randomUUID() + randomUUID();
    }

    // Use one real Redis client, not a mocked increment() or mutable
    // REDIS_URL: other E2E modules may initialize the global ConfigModule.
    storage = new DistributedThrottlerStorage({
      get: (key: string) => key === 'REDIS_URL' ? testRedisUrl : undefined,
    } as never);

    const { AppModule } = await import('../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DistributedThrottlerStorage)
      .useValue(storage)
      .overrideProvider(Mailer)
      .useValue(mailer)
      // Isolate the account-level guards: otherwise global IP throttling
      // may return first and conceal their fail-closed behavior.
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
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
    expect(app.get(DistributedThrottlerStorage)).toBe(storage);

    // The controlled fault acts on the actual client owned by storage.
    // Do not touch or restart the shared TEST_REDIS_URL Redis service.
    const client = (storage as unknown as { redis: Redis | null }).redis;
    if (!client) throw new Error('Expected Redis-backed throttling storage');
    redisClient = client;
    expect(await storage.checkReadiness()).toBe(true);
    expect(redisClient.status).toBe('ready');

    const hasher = app.get(PasswordHasher);
    const created = await prisma.user.create({
      data: { email, passwordHash: await hasher.hash(password) },
      select: { id: true },
    });
    userId = created.id;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    cookie = sessionCookie(login.headers['set-cookie']);
    mailer.send.mockClear();
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma && userId) {
        await prisma.user.deleteMany({ where: { id: userId } });
      }
      await app?.close();
      if (!app && storage) {
        await storage.onApplicationShutdown();
      }
    } finally {
      for (const key of ['DATABASE_URL', 'APP_URL', 'JWT_SECRET'] as const) {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
      }
    }
  }, 20_000);

  it('denies both flows while the Redis client is disconnected, then resumes with original quotas', async () => {
    await assertPrivateResponse(202, await forgot());
    await assertPrivateResponse(202, await resend());
    await vi.waitFor(() => {
      expect(mailer.send).toHaveBeenCalledTimes(2);
    }, { timeout: 5_000, interval: 25 });
    expect(await prisma.emailToken.count({ where: { userId } })).toBe(2);

    // Simulate an unavailable Redis connection for this application only.
    // With no memory fallback, both account guards must fail closed.
    redisClient.disconnect();
    // ioredis emits the socket's close event asynchronously. Checking
    // status immediately after disconnect() can still return "ready".
    await vi.waitFor(() => {
      expect(redisClient.status).toBe('end');
    }, { timeout: 5_000, interval: 25 });
    expect(await storage.checkReadiness()).toBe(false);

    await assertPrivateResponse(503, await forgot());
    await assertPrivateResponse(503, await resend());
    await assertPrivateResponse(
      503,
      await forgot('unknown-' + randomUUID() + '@example.test'),
    );
    expect(mailer.send).toHaveBeenCalledTimes(2);
    expect(await prisma.emailToken.count({ where: { userId } })).toBe(2);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { emailVerified: true },
      }),
    ).toEqual({ emailVerified: false });

    // Restore the same ioredis client without restarting NestJS.
    await redisClient.connect();
    expect(await storage.checkReadiness()).toBe(true);

    await assertPrivateResponse(202, await forgot());
    await assertPrivateResponse(202, await resend());
    await vi.waitFor(() => {
      expect(mailer.send).toHaveBeenCalledTimes(4);
    }, { timeout: 5_000, interval: 25 });
    expect(await prisma.emailToken.count({ where: { userId } })).toBe(4);
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', cookie)
      .expect(200);

    // Reconnecting a client must not reset persisted account quotas.
    for (let index = 0; index < 3; index++) {
      await assertPrivateResponse(202, await forgot());
      await assertPrivateResponse(202, await resend());
    }
    await assertPrivateResponse(429, await forgot());
    await assertPrivateResponse(429, await resend());
    await vi.waitFor(() => {
      expect(mailer.send).toHaveBeenCalledTimes(10);
    }, { timeout: 5_000, interval: 25 });
    expect(await prisma.emailToken.count({ where: { userId } })).toBe(10);
  }, 30_000);
});
