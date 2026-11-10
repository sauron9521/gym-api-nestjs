import { randomUUID } from 'node:crypto';

import {
  EmailVerificationService,
  PasswordHasher,
  PasswordResetService,
} from '@nestjs/authentication';
import {
  StandardSchemaValidationPipe,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Mailer } from '@nestjs/mail';
import { Test } from '@nestjs/testing';
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
const nextPassword = 'UpdatedPassword456!';
const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  APP_URL: process.env.APP_URL,
  JWT_SECRET: process.env.JWT_SECRET,
};

describe('Auth recovery route throttling (real HTTP guard + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordReset: PasswordResetService;
  let emailVerification: EmailVerificationService;
  let userId = '';
  const email = `recovery-throttle-${randomUUID()}@example.test`;

  const mailer = {
    send: vi.fn(async () => undefined),
  };

  function sessionCookie(headers: string | string[] | undefined): string {
    const raw = Array.isArray(headers) ? headers : headers ? [headers] : [];
    const cookie = raw
      .map((value) => value.split(';', 1)[0] ?? '')
      .find((value) => value.startsWith('__Host-sid='));
    if (!cookie) {
      throw new Error('Expected an authenticated session cookie');
    }
    return cookie;
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

    // Deliberately DO NOT override ThrottlerGuard: these checks exercise
    // the real APP_GUARD, route @Throttle metadata and configured storage.
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
    passwordReset = app.get(PasswordResetService);
    emailVerification = app.get(EmailVerificationService);

    const hasher = app.get(PasswordHasher);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hasher.hash(password),
      },
      select: { id: true },
    });
    userId = user.id;
  }, 30_000);

  beforeEach(() => {
    mailer.send.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('allows three forgot requests and blocks the fourth before creating a token or email', async () => {
    const requestSpy = vi.spyOn(passwordReset, 'request');

    for (let index = 0; index < 3; index++) {
      const response = await request(app.getHttpServer())
        .post('/auth/password-reset/forgot')
        .send({ email })
        .expect(202);
      expect(response.body).toEqual({});
      expect(response.headers['cache-control']).toBe('no-store');
    }

    await vi.waitFor(() => {
      expect(mailer.send).toHaveBeenCalledTimes(3);
    }, { timeout: 5_000, interval: 25 });

    const tokenCount = await prisma.emailToken.count({
      where: { userId, purpose: 'password-reset' },
    });
    expect(tokenCount).toBe(3);

    const denied = await request(app.getHttpServer())
      .post('/auth/password-reset/forgot')
      .send({ email })
      .expect(429);
    expect(denied.headers['cache-control']).toBe('no-store');

    expect(requestSpy).toHaveBeenCalledTimes(3);
    expect(mailer.send).toHaveBeenCalledTimes(3);
    expect(
      await prisma.emailToken.count({
        where: { userId, purpose: 'password-reset' },
      }),
    ).toBe(tokenCount);
  });

  it('limits reset to three attempts without calling the service for a fourth', async () => {
    const resetSpy = vi.spyOn(passwordReset, 'reset');
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    const tokenCount = await prisma.emailToken.count({ where: { userId } });
    const sessionCount = await prisma.session.count({ where: { userId } });
    const invalidToken = randomUUID().replaceAll('-', '').repeat(2);

    for (let index = 0; index < 3; index++) {
      const response = await request(app.getHttpServer())
        .post('/auth/password-reset/reset')
        .send({ token: invalidToken, password: nextPassword })
        .expect(400);
      expect(response.headers['cache-control']).toBe('no-store');
    }

    const denied = await request(app.getHttpServer())
      .post('/auth/password-reset/reset')
      .send({ token: invalidToken, password: nextPassword })
      .expect(429);
    expect(denied.headers['cache-control']).toBe('no-store');
    expect(resetSpy).toHaveBeenCalledTimes(3);

    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true },
      }),
    ).toEqual(stored);
    expect(await prisma.emailToken.count({ where: { userId } })).toBe(
      tokenCount,
    );
    expect(await prisma.session.count({ where: { userId } })).toBe(
      sessionCount,
    );
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('allows three authenticated verification resends then blocks email and token creation', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const cookie = sessionCookie(login.headers['set-cookie']);
    const sendSpy = vi.spyOn(emailVerification, 'send');
    const tokenCount = await prisma.emailToken.count({
      where: { userId, purpose: 'email-verification' },
    });

    for (let index = 0; index < 3; index++) {
      const response = await request(app.getHttpServer())
        .post('/auth/email/verification')
        .set('Cookie', cookie)
        .expect(202);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({});
    }

    const afterAllowed = await prisma.emailToken.count({
      where: { userId, purpose: 'email-verification' },
    });
    expect(afterAllowed).toBe(tokenCount + 3);
    expect(mailer.send).toHaveBeenCalledTimes(3);

    const denied = await request(app.getHttpServer())
      .post('/auth/email/verification')
      .set('Cookie', cookie)
      .expect(429);
    expect(denied.headers['cache-control']).toBe('no-store');
    expect(sendSpy).toHaveBeenCalledTimes(3);
    expect(mailer.send).toHaveBeenCalledTimes(3);
    expect(
      await prisma.emailToken.count({
        where: { userId, purpose: 'email-verification' },
      }),
    ).toBe(afterAllowed);

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', cookie)
      .expect(200);
  });
});
