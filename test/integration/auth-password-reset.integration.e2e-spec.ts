import { randomUUID } from 'node:crypto';
import { PasswordHasher } from '@nestjs/authentication';
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

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  APP_URL: process.env.APP_URL,
  JWT_SECRET: process.env.JWT_SECRET,
};

const oldPassword = 'StrongPassword123!';
const newPassword = 'UpdatedPassword456!';

describe('Password reset security (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordHasher: PasswordHasher;
  let userId = '';
  let email = '';

  const deliveries: Array<{ to: string; url: string }> = [];
  const mailer = {
    send: vi.fn(
      async (_mail: unknown, options: { to: string; data: { url: string } }) => {
        deliveries.push({ to: options.to, url: options.data.url });
      },
    ),
  };

  function cookieFrom(headers: string | string[] | undefined): string {
    const cookies = Array.isArray(headers)
      ? headers
      : headers
        ? [headers]
        : [];
    const cookie = cookies
      .map((value) => value.split(';', 1)[0] ?? '')
      .find((value) => value.startsWith('__Host-sid='));
    if (!cookie) {
      throw new Error('Expected a session cookie after authentication');
    }
    return cookie;
  }

  async function requestResetLink(forEmail = email): Promise<string> {
    const previousCount = deliveries.filter(
      (delivery) => delivery.to === forEmail,
    ).length;
    const response = await request(app.getHttpServer())
      .post('/auth/password-reset/forgot')
      .send({ email: forEmail })
      .expect(202);

    expect(response.body).toEqual({});
    expect(response.headers['cache-control']).toBe('no-store');

    // PasswordResetService dispatches mail asynchronously after HTTP 202.
    const delivery = await vi.waitFor(() => {
      const found = deliveries.filter((item) => item.to === forEmail);
      const next = found[previousCount];
      if (!next) {
        throw new Error('Password reset email has not been delivered');
      }
      return next;
    }, { timeout: 5_000, interval: 25 });

    const token = new URL(delivery.url).searchParams.get('token');
    if (!token) {
      throw new Error('Password reset email does not contain a token');
    }
    return token;
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
    passwordHasher = app.get(PasswordHasher);
  }, 30_000);

  beforeEach(async () => {
    deliveries.length = 0;
    mailer.send.mockClear();
    email = `password-reset-${randomUUID()}@example.test`;

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await passwordHasher.hash(oldPassword),
      },
      select: { id: true },
    });
    userId = user.id;
  });

  afterEach(async () => {
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    userId = '';
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

  it('returns the same safe 202 for existing and unknown addresses', async () => {
    const unknownEmail = `missing-${randomUUID()}@example.test`;

    const known = await request(app.getHttpServer())
      .post('/auth/password-reset/forgot')
      .send({ email })
      .expect(202);
    const unknown = await request(app.getHttpServer())
      .post('/auth/password-reset/forgot')
      .send({ email: unknownEmail })
      .expect(202);

    expect(known.body).toEqual(unknown.body);
    expect(known.body).toEqual({});
    expect(known.headers['cache-control']).toBe('no-store');
    expect(unknown.headers['cache-control']).toBe('no-store');

    await vi.waitFor(() => {
      expect(deliveries.some((delivery) => delivery.to === email)).toBe(true);
    }, { timeout: 5_000, interval: 25 });

    expect(deliveries.some((delivery) => delivery.to === unknownEmail)).toBe(
      false,
    );
    expect(
      await prisma.emailToken.count({
        where: { userId, purpose: 'password-reset' },
      }),
    ).toBeGreaterThan(0);
  });

  it('rejects invalid and expired reset links without changing credentials', async () => {
    const token = await requestResetLink();

    const invalid = await request(app.getHttpServer())
      .post('/auth/password-reset/reset')
      .send({ token: randomUUID() + randomUUID(), password: newPassword })
      .expect(400);
    expect(invalid.headers['cache-control']).toBe('no-store');

    await prisma.emailToken.updateMany({
      where: { userId, purpose: 'password-reset' },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await request(app.getHttpServer())
      .post('/auth/password-reset/reset')
      .send({ token, password: newPassword })
      .expect(400);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: oldPassword })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: newPassword })
      .expect(401);
  });

  it('rotates the password, consumes the reset link, and revokes older sessions and refresh tokens', async () => {
    const firstLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: oldPassword })
      .expect(200);
    const secondLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: oldPassword })
      .expect(200);
    const firstCookie = cookieFrom(firstLogin.headers['set-cookie']);
    const secondCookie = cookieFrom(secondLogin.headers['set-cookie']);

    const issued = await request(app.getHttpServer())
      .post('/auth/token')
      .send({ email, password: oldPassword })
      .expect(200);
    const refreshToken = (issued.body as { refreshToken: string }).refreshToken;

    const token = await requestResetLink();
    const reset = await request(app.getHttpServer())
      .post('/auth/password-reset/reset')
      .send({ token, password: newPassword })
      .expect(200);
    expect(reset.headers['cache-control']).toBe('no-store');
    expect(reset.body).toEqual({ mfaRequired: false });

    // signIn: true issues a new cookie. The two pre-reset cookies are revoked.
    const replacementCookie = cookieFrom(reset.headers['set-cookie']);
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', replacementCookie)
      .expect(200);

    for (const cookie of [firstCookie, secondCookie]) {
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Cookie', cookie)
        .expect(401);
    }

    await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: oldPassword })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: newPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/password-reset/reset')
      .send({ token, password: oldPassword })
      .expect(400);

    expect(await prisma.session.count({ where: { userId } })).toBe(2);
    const families = await prisma.refreshTokenFamily.findMany({
      where: { userId },
      select: { revokedAt: true },
    });
    expect(families).toHaveLength(1);
    expect(families[0]?.revokedAt).toBeInstanceOf(Date);
  });

  it('invalidates a second unused reset link after resetting with the first', async () => {
    const first = await requestResetLink();
    const second = await requestResetLink();

    expect(first).not.toBe(second);

    await request(app.getHttpServer())
      .post('/auth/password-reset/reset')
      .send({ token: first, password: newPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/password-reset/reset')
      .send({ token: second, password: oldPassword })
      .expect(400);

    expect(
      await prisma.emailToken.count({
        where: { userId, purpose: 'password-reset' },
      }),
    ).toBe(0);
  });
});
