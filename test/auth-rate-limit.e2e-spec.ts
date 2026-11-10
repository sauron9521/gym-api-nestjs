import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { EmailVerificationService, PasswordResetService, SignInService, TokenService } from '@nestjs/authentication';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuthController } from '../src/modules/auth/controllers/auth.controller.js';
import { EmailVerificationController } from '../src/modules/auth/controllers/email-verification.controller.js';
import { TokensController } from '../src/modules/auth/controllers/tokens.controller.js';
import { PasswordResetController } from '../src/modules/auth/controllers/password-reset.controller.js';
import { CredentialsService } from '../src/modules/auth/services/credentials.service.js';
import { AuthNoStoreMiddleware } from '../src/modules/auth/middleware/auth-no-store.middleware.js';

describe('Auth endpoint throttling (HTTP)', () => {
  let app: INestApplication;

  const credentials = {
    register: vi.fn().mockResolvedValue({ id: 'test-user', email: 'member@example.test' }),
    verify: vi.fn().mockResolvedValue({ id: 'test-user' }),
  };
  const signIn = {
    signIn: vi.fn().mockResolvedValue({ session: { mfa: 'none' } }),
  };
  const verification = {
    verify: vi.fn().mockResolvedValue({ email: 'member@example.test' }),
    send: vi.fn().mockResolvedValue(undefined),
  };
  const passwordReset = {
    request: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue({
      signedIn: { session: { mfa: 'none' } },
    }),
  };
  const tokens = {
    refresh: vi.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
    revoke: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({
        throttlers: [{ limit: 100, ttl: 60000 }],
      })],
      controllers: [AuthController, EmailVerificationController, PasswordResetController, TokensController],
      providers: [
        { provide: CredentialsService, useValue: credentials },
        { provide: SignInService, useValue: signIn },
        { provide: EmailVerificationService, useValue: verification },
        { provide: PasswordResetService, useValue: passwordReset },
        { provide: TokenService, useValue: tokens },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    const authHeaders = new AuthNoStoreMiddleware();
    app.use(authHeaders.use.bind(authHeaders));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('limits registration to 3 requests/minute', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'member@example.test', password: 'StrongPassword123!' })
        .expect(201);
    }

    const denied = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'member@example.test', password: 'StrongPassword123!' })
      .expect(429);

    expect(denied.headers['cache-control']).toBe('no-store');

    expect(credentials.register).toHaveBeenCalledTimes(3);
  });


  it('limits password recovery requests to three and does not queue another email after 429', async () => {
    passwordReset.request.mockClear();
    for (let i = 0; i < 3; i++) {
      const accepted = await request(app.getHttpServer())
        .post('/auth/password-reset/forgot')
        .send({ email: 'member@example.test' })
        .expect(202);
      expect(accepted.headers['cache-control']).toBe('no-store');
    }

    const blocked = await request(app.getHttpServer())
      .post('/auth/password-reset/forgot')
      .send({ email: 'member@example.test' })
      .expect(429);

    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(passwordReset.request).toHaveBeenCalledTimes(3);
    expect(passwordReset.request).toHaveBeenCalledWith('member@example.test');
  });

  it('limits password reset attempts to three and does not process a token after 429', async () => {
    passwordReset.reset.mockClear();
    for (let i = 0; i < 3; i++) {
      const accepted = await request(app.getHttpServer())
        .post('/auth/password-reset/reset')
        .send({ token: 'example-reset-token', password: 'StrongPassword456!' })
        .expect(200);
      expect(accepted.body).toEqual({ mfaRequired: false });
      expect(accepted.headers['cache-control']).toBe('no-store');
    }

    const blocked = await request(app.getHttpServer())
      .post('/auth/password-reset/reset')
      .send({ token: 'another-reset-token', password: 'StrongPassword456!' })
      .expect(429);

    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(passwordReset.reset).toHaveBeenCalledTimes(3);
    expect(passwordReset.reset).toHaveBeenCalledWith(
      'example-reset-token',
      'StrongPassword456!',
      { signIn: true },
    );
    expect(passwordReset.reset).not.toHaveBeenCalledWith(
      'another-reset-token',
      expect.anything(),
      expect.anything(),
    );
  });

  it('limits email verification to 8 requests/minute', async () => {
    for (let i = 0; i < 8; i++) {
      await request(app.getHttpServer())
        .post('/auth/email/verify')
        .send({ token: 'example-token' })
        .expect(200);
    }

    const denied = await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: 'example-token' })
      .expect(429);

    expect(denied.headers['cache-control']).toBe('no-store');

    expect(verification.verify).toHaveBeenCalledTimes(8);
  });

  it('allows 20 refresh operations and rejects the 21st', async () => {
    for (let i = 0; i < 20; i++) {
      await request(app.getHttpServer())
        .post('/auth/token/refresh')
        .send({ refreshToken: 'example-token' })
        .expect(200);
    }

    const denied = await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken: 'example-token' })
      .expect(429);

    expect(denied.headers['cache-control']).toBe('no-store');

    expect(tokens.refresh).toHaveBeenCalledTimes(20);
  });

  it('limits token revocation to 10 requests/minute', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/auth/token/revoke')
        .send({ refreshToken: 'example-token' })
        .expect(204);
    }

    const denied = await request(app.getHttpServer())
      .post('/auth/token/revoke')
      .send({ refreshToken: 'example-token' })
      .expect(429);

    expect(denied.headers['cache-control']).toBe('no-store');

    expect(tokens.revoke).toHaveBeenCalledTimes(10);
  });
});
