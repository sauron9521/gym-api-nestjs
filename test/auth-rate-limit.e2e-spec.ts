import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EmailVerificationService, SignInService, TokenService } from '@nestjs/authentication';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuthController } from '../src/modules/auth/controllers/auth.controller.js';
import { EmailVerificationController } from '../src/modules/auth/controllers/email-verification.controller.js';
import { TokensController } from '../src/modules/auth/controllers/tokens.controller.js';
import { CredentialsService } from '../src/modules/auth/services/credentials.service.js';
import { AuthNoStoreMiddleware } from '../src/modules/auth/middleware/auth-no-store.middleware.js';
import { VerificationResendRateLimitGuard } from '../src/modules/auth/guards/verification-resend-rate-limit.guard.js';
import { DistributedThrottlerStorage } from '../src/common/rate-limit/distributed-throttler.storage.js';

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
  const tokens = {
    refresh: vi.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
    revoke: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({
        throttlers: [{ limit: 100, ttl: 60000 }],
      })],
      controllers: [AuthController, EmailVerificationController, TokensController],
      providers: [
        { provide: CredentialsService, useValue: credentials },
        { provide: SignInService, useValue: signIn },
        { provide: EmailVerificationService, useValue: verification },
        { provide: DistributedThrottlerStorage, useValue: { increment: vi.fn() } },
        { provide: ConfigService, useValue: { getOrThrow: () => 'test-only' } },
        { provide: TokenService, useValue: tokens },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    })
      .overrideGuard(VerificationResendRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

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
