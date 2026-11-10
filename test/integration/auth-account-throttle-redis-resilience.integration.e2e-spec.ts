import { randomUUID } from 'node:crypto';
import {
  connect as connectSocket,
  createServer,
  type Server,
  type Socket,
} from 'node:net';

import { PasswordHasher } from '@nestjs/authentication';
import {
  StandardSchemaValidationPipe,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Mailer } from '@nestjs/mail';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
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

/**
 * A network fault injector isolated to this suite. The GitHub Actions Redis
 * service stays up for other tests; this proxy can cut/reopen connections.
 */
redisDescribe('Account throttle Redis outage and recovery (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: DistributedThrottlerStorage;
  let proxy: Server | undefined;
  let proxyOnline = true;
  const sockets = new Set<Socket>();
  const email = 'rate-recovery-' + randomUUID() + '@example.test';
  let userId = '';
  let cookie = '';
  const mailer = { send: vi.fn(async () => undefined) };

  function cutRedisConnection(): void {
    proxyOnline = false;
    for (const socket of sockets) {
      socket.destroy();
    }
  }

  async function makeProxy(url: string): Promise<number> {
    const upstream = new URL(url);
    if (upstream.protocol !== 'redis:') {
      throw new Error('TEST_REDIS_URL must use plain redis:// for the test proxy');
    }
    const upstreamPort = Number(upstream.port || '6379');

    proxy = createServer((client) => {
      client.on('error', () => undefined);
      if (!proxyOnline) {
        client.destroy();
        return;
      }

      const remote = connectSocket({
        host: upstream.hostname,
        port: upstreamPort,
      });
      remote.on('error', () => client.destroy());
      sockets.add(client);
      sockets.add(remote);
      client.on('close', () => {
        sockets.delete(client);
        remote.destroy();
      });
      remote.on('close', () => {
        sockets.delete(remote);
        client.destroy();
      });
      client.pipe(remote).pipe(client);
    });

    await new Promise<void>((resolve, reject) => {
      proxy!.once('error', reject);
      proxy!.listen(0, '127.0.0.1', () => {
        proxy!.off('error', reject);
        resolve();
      });
    });
    const address = proxy.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to bind Redis fault-injection proxy');
    }
    return address.port;
  }

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
    const port = await makeProxy(testRedisUrl!);
    const proxyUrl = 'redis://127.0.0.1:' + port;

    // Inject one *real* Redis-backed storage through the proxy. ConfigModule
    // may be initialized by other E2E imports before this test changes env,
    // so relying on process.env.REDIS_URL would silently select memory.
    // Override the shared provider rather than faking increment() calls.
    storage = new DistributedThrottlerStorage({
      get: (key: string) => key === 'REDIS_URL' ? proxyUrl : undefined,
    } as never);

    const { AppModule } = await import('../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DistributedThrottlerStorage)
      .useValue(storage)
      .overrideProvider(Mailer)
      .useValue(mailer)
      // Isolate both account guards: otherwise the global IP limiter fails
      // first and masks their own fail-closed behavior.
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
    expect(await storage.checkReadiness()).toBe(true);

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
      for (const socket of sockets) {
        socket.destroy();
      }
      if (proxy?.listening) {
        await new Promise<void>((resolve) => proxy!.close(() => resolve()));
      }
    } finally {
      for (const key of ['DATABASE_URL', 'APP_URL', 'JWT_SECRET'] as const) {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
      }
    }
  }, 20_000);

  it('fails closed without emails or tokens, then resumes both auth flows after Redis recovers', async () => {
    // Prove the real Redis connection and both account guards work first.
    await assertPrivateResponse(202, await forgot());
    await assertPrivateResponse(202, await resend());
    await vi.waitFor(() => {
      expect(mailer.send).toHaveBeenCalledTimes(2);
    }, { timeout: 5_000, interval: 25 });
    expect(await prisma.emailToken.count({ where: { userId } })).toBe(2);

    cutRedisConnection();
    await vi.waitFor(async () => {
      expect(await storage.checkReadiness()).toBe(false);
    }, { timeout: 5_000, interval: 100 });

    // No process-local fallback. Both endpoints return 503 before service
    // calls. This also protects against a flood during Redis downtime.
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

    proxyOnline = true;
    await vi.waitFor(async () => {
      expect(await storage.checkReadiness()).toBe(true);
    }, { timeout: 12_000, interval: 150 });

    // The original cookie remains valid. Both HTTP routes resume normally.
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

    // The already-accepted requests still count against the original
    // Redis quota: an outage must not reset the five-per-hour limit.
    for (let index = 0; index < 3; index++) {
      await assertPrivateResponse(202, await forgot());
      await assertPrivateResponse(202, await resend());
    }
    await assertPrivateResponse(429, await forgot());
    await assertPrivateResponse(429, await resend());
    expect(mailer.send).toHaveBeenCalledTimes(10);
    expect(await prisma.emailToken.count({ where: { userId } })).toBe(10);
  }, 30_000);
});
