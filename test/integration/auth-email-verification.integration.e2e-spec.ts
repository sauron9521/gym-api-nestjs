import { randomUUID } from 'node:crypto';
import {
  StandardSchemaValidationPipe,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Mailer } from '@nestjs/mail';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { PrismaService } from '../../src/infra/database/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

const password = 'StrongPassword123!';
const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  APP_URL: process.env.APP_URL,
  JWT_SECRET: process.env.JWT_SECRET,
};

type RegisteredAccount = {
  id: string;
  email: string;
  cookie: string;
  token: string;
};

describe('Email verification security (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdUsers: string[] = [];
  const deliveries: Array<{ to: string; url: string }> = [];

  const mailer = {
    send: vi.fn(
      async (_mail: unknown, options: { to: string; data: { url: string } }) => {
        deliveries.push({ to: options.to, url: options.data.url });
      },
    ),
  };

  function sessionCookie(headers: string | string[] | undefined): string {
    const raw = Array.isArray(headers)
      ? headers
      : headers
        ? [headers]
        : [];
    const cookie = raw
      .map((value) => value.split(';', 1)[0] ?? '')
      .find((value) => value.startsWith('__Host-sid='));
    if (!cookie) {
      throw new Error('Expected session cookie after registration');
    }
    return cookie;
  }

  async function deliveredToken(
    email: string,
    deliveryIndex = 0,
  ): Promise<string> {
    const delivery = await vi.waitFor(() => {
      const found = deliveries.filter((item) => item.to === email);
      const next = found[deliveryIndex];
      if (!next) {
        throw new Error('Verification email not yet submitted');
      }
      return next;
    }, { timeout: 5_000, interval: 25 });

    const token = new URL(delivery.url).searchParams.get('token');
    if (!token) {
      throw new Error('Verification link has no token');
    }
    return token;
  }

  async function register(): Promise<RegisteredAccount> {
    const email = `verify-${randomUUID()}@example.test`;
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const id = (response.body as { id: string }).id;
    createdUsers.push(id);

    expect(response.body).toMatchObject({
      id,
      email,
      emailVerified: false,
      verificationEmailStatus: 'SUBMITTED',
    });
    expect(response.headers['cache-control']).toBe('no-store');

    return {
      id,
      email,
      cookie: sessionCookie(response.headers['set-cookie']),
      token: await deliveredToken(email),
    };
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
  }, 30_000);

  beforeEach(() => {
    deliveries.length = 0;
    mailer.send.mockClear();
  });

  afterEach(async () => {
    if (createdUsers.length) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUsers } },
      });
    }
    createdUsers.length = 0;
  });

  afterAll(async () => {
    try {
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

  it('verifies only the token owner, never the other logged-in user, and forbids replay', async () => {
    const owner = await register();
    const other = await register();

    // Verification is public and tied to the emailed token, not a cookie.
    const verified = await request(app.getHttpServer())
      .post('/auth/email/verify')
      .set('Cookie', other.cookie)
      .send({ token: owner.token })
      .expect(200);

    expect(verified.body).toEqual({
      email: owner.email,
      emailVerified: true,
    });
    expect(verified.headers['cache-control']).toBe('no-store');

    const users = await prisma.user.findMany({
      where: { id: { in: [owner.id, other.id] } },
      select: { id: true, emailVerified: true },
    });
    expect(users.find((user) => user.id === owner.id)?.emailVerified).toBe(true);
    expect(users.find((user) => user.id === other.id)?.emailVerified).toBe(
      false,
    );

    const replay = await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: owner.token })
      .expect(400);
    expect(replay.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(replay.body)).not.toContain(owner.token);
  });

  it('rejects malformed and expired verification links without changing emailVerified', async () => {
    const account = await register();

    const invalid = await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: randomUUID() + randomUUID() })
      .expect(400);
    expect(invalid.headers['cache-control']).toBe('no-store');

    const tokens = await prisma.emailToken.findMany({
      where: { userId: account.id },
      select: { id: true },
    });
    expect(tokens.length).toBeGreaterThan(0);
    await prisma.emailToken.updateMany({
      where: { userId: account.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: account.token })
      .expect(400);
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: account.id },
      select: { emailVerified: true },
    });
    expect(current.emailVerified).toBe(false);
  });

  it('resends verification for an unverified account, then rejects resend after verification', async () => {
    const account = await register();
    const beforeCount = deliveries.filter((item) => item.to === account.email)
      .length;

    const resent = await request(app.getHttpServer())
      .post('/auth/email/verification')
      .set('Cookie', account.cookie)
      .expect(202);
    expect(resent.body).toEqual({});
    expect(resent.headers['cache-control']).toBe('no-store');
    const newToken = await deliveredToken(account.email, beforeCount);
    expect(newToken).not.toBe(account.token);

    await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: newToken })
      .expect(200);

    const rejected = await request(app.getHttpServer())
      .post('/auth/email/verification')
      .set('Cookie', account.cookie)
      .expect(409);
    expect(rejected.headers['cache-control']).toBe('no-store');
    expect(deliveries.filter((item) => item.to === account.email)).toHaveLength(
      beforeCount + 1,
    );

    await request(app.getHttpServer())
      .post('/auth/email/verification')
      .expect(401);
  });

  it('does not verify a new address with a link issued for an old address', async () => {
    const account = await register();
    const updatedEmail = `changed-${randomUUID()}@example.test`;

    // Simulates a future email change before the earlier verification link is used.
    await prisma.user.update({
      where: { id: account.id },
      data: { email: updatedEmail },
    });

    const rejected = await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: account.token })
      .expect(400);
    expect(rejected.headers['cache-control']).toBe('no-store');

    const current = await prisma.user.findUniqueOrThrow({
      where: { id: account.id },
      select: { email: true, emailVerified: true },
    });
    expect(current).toEqual({
      email: updatedEmail,
      emailVerified: false,
    });
  });
  it('allows only one of two concurrent HTTP requests to consume a verification token', async () => {
    const account = await register();

    const attempts = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/email/verify')
        .send({ token: account.token }),
      request(app.getHttpServer())
        .post('/auth/email/verify')
        .send({ token: account.token }),
    ]);

    expect(attempts.map((response) => response.status).sort()).toEqual([
      200,
      400,
    ]);
    for (const response of attempts) {
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(attempts.find((response) => response.status === 200)?.body).toEqual({
      email: account.email,
      emailVerified: true,
    });
    expect(
      JSON.stringify(attempts.find((response) => response.status === 400)?.body),
    ).not.toContain(account.token);

    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: account.id },
        select: { emailVerified: true },
      }),
    ).toEqual({ emailVerified: true });
    expect(
      await prisma.emailToken.count({ where: { userId: account.id } }),
    ).toBe(0);
  });

  it('keeps reset and verification tokens isolated by purpose without consuming the wrong link', async () => {
    const account = await register();
    const priorDeliveries = deliveries.filter(
      (delivery) => delivery.to === account.email,
    ).length;
    await request(app.getHttpServer())
      .post('/auth/password-reset/forgot')
      .send({ email: account.email })
      .expect(202);
    const resetToken = await deliveredToken(account.email, priorDeliveries);
    expect(resetToken).not.toBe(account.token);

    const before = await prisma.emailToken.findMany({
      where: { userId: account.id },
      select: { id: true, purpose: true },
      orderBy: { id: 'asc' },
    });
    expect(before).toHaveLength(2);
    expect(new Set(before.map((token) => token.purpose)).size).toBe(2);

    const wrongVerification = await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: resetToken })
      .expect(400);
    const wrongReset = await request(app.getHttpServer())
      .post('/auth/password-reset/reset')
      .send({ token: account.token, password: 'UpdatedPassword456!' })
      .expect(400);
    expect(wrongVerification.headers['cache-control']).toBe('no-store');
    expect(wrongReset.headers['cache-control']).toBe('no-store');

    expect(
      await prisma.emailToken.findMany({
        where: { userId: account.id },
        select: { id: true, purpose: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);

    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: account.id },
        select: { emailVerified: true },
      }),
    ).toEqual({ emailVerified: false });

    // The failed cross-purpose attempts must leave both links usable.
    await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: account.token })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/password-reset/reset')
      .send({ token: resetToken, password: 'UpdatedPassword456!' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: account.email, password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: account.email, password: 'UpdatedPassword456!' })
      .expect(200);
  });

  it('never verifies a soft-deleted account with a previously issued link', async () => {
    const account = await register();
    await prisma.user.update({
      where: { id: account.id },
      data: { deletedAt: new Date() },
    });

    const denied = await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: account.token });
    expect([400, 404]).toContain(denied.status);
    expect(denied.headers['cache-control']).toBe('no-store');
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: account.id },
        select: { emailVerified: true },
      }),
    ).toEqual({ emailVerified: false });
  });

});
