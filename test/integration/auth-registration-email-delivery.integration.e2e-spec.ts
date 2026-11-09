import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { StandardSchemaValidationPipe, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Mailer } from '@nestjs/mail';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/infra/database/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

describe('Registration email submission recovery (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const mailer = { send: vi.fn() };
  const suffix = randomUUID();
  const successEmail = `signup-email-ok-${suffix}@example.test`;
  const failedEmail = `signup-email-failure-${suffix}@example.test`;
  const password = 'StrongPassword123!';

  function sessionCookie(headers: string | string[] | undefined): string {
    const raw = Array.isArray(headers) ? headers : headers ? [headers] : [];
    const cookie = raw
      .map((value) => value.split(';', 1)[0] ?? '')
      .find((value) => value.startsWith('__Host-sid='));
    if (!cookie) {
      throw new Error('Expected session cookie after successful registration');
    }
    return cookie;
  }

  beforeAll(async () => {
    useTestDatabase();

    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(Mailer)
      .useValue(mailer)
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
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
      if (prisma) {
        // Cascades remove sessions and email tokens for the isolated users.
        await prisma.user.deleteMany({
          where: { email: { in: [successEmail, failedEmail] } },
        });
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('returns SUBMITTED when the SMTP call succeeds', async () => {
    mailer.send.mockReset().mockResolvedValue(undefined);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: successEmail, password });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: expect.any(String),
      email: successEmail,
      emailVerified: false,
      verificationEmailStatus: 'SUBMITTED',
    });
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(sessionCookie(response.headers['set-cookie'])).toMatch(/^__Host-sid=/);
    expect(mailer.send).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('does not turn a persisted account into a failed signup and permits resend', async () => {
    mailer.send.mockReset().mockRejectedValue(new Error('SECRET SMTP auth detail'));

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: failedEmail, password });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: expect.any(String),
      email: failedEmail,
      emailVerified: false,
      verificationEmailStatus: 'RETRY_REQUIRED',
    });
    expect(JSON.stringify(response.body)).not.toContain('SECRET SMTP');
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(response.headers['cache-control']).toBe('no-store');
    const cookie = sessionCookie(response.headers['set-cookie']);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: failedEmail },
      select: { id: true, emailVerified: true, passwordHash: true },
    });
    expect(user.id).toBe(response.body.id);
    expect(user.emailVerified).toBe(false);
    expect(user.passwordHash).not.toBe(password);
    expect(await prisma.session.count({ where: { userId: user.id } }))
      .toBeGreaterThan(0);

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', cookie)
      .expect(200);

    // Repeating registration does not fix SMTP; the account already exists.
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: failedEmail, password })
      .expect(409);

    // While the mailer is still down, resend returns a safe, retryable 503.
    const unavailable = await request(app.getHttpServer())
      .post('/auth/email/verification')
      .set('Cookie', cookie);
    expect(unavailable.status).toBe(503);
    expect(JSON.stringify(unavailable.body)).not.toContain('SECRET SMTP');
    expect(JSON.stringify(unavailable.body)).not.toContain(failedEmail);

    // Once SMTP recovers, the already authenticated account can resend.
    mailer.send.mockResolvedValue(undefined);
    await request(app.getHttpServer())
      .post('/auth/email/verification')
      .set('Cookie', cookie)
      .expect(202);
    expect(mailer.send).toHaveBeenCalledTimes(3);
    expect(await prisma.emailToken.count({ where: { userId: user.id } }))
      .toBeGreaterThan(0);
  }, 30_000);
});
