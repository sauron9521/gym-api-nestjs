import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { EmailVerificationService, SignInService, TokenService } from '@nestjs/authentication';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuthController } from '../src/modules/auth/controllers/auth.controller.js';
import { EmailVerificationController } from '../src/modules/auth/controllers/email-verification.controller.js';
import { TokensController } from '../src/modules/auth/controllers/tokens.controller.js';
import { CredentialsService } from '../src/modules/auth/services/credentials.service.js';

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
        { provide: TokenService, useValue: tokens },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
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

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'member@example.test', password: 'StrongPassword123!' })
      .expect(429);

    expect(credentials.register).toHaveBeenCalledTimes(3);
  });

  it('limits email verification to 8 requests/minute', async () => {
    for (let i = 0; i < 8; i++) {
      await request(app.getHttpServer())
        .post('/auth/email/verify')
        .send({ token: 'example-token' })
        .expect(200);
    }

    await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: 'example-token' })
      .expect(429);

    expect(verification.verify).toHaveBeenCalledTimes(8);
  });

  it('allows 20 refresh operations and rejects the 21st', async () => {
    for (let i = 0; i < 20; i++) {
      await request(app.getHttpServer())
        .post('/auth/token/refresh')
        .send({ refreshToken: 'example-token' })
        .expect(200);
    }

    await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken: 'example-token' })
      .expect(429);

    expect(tokens.refresh).toHaveBeenCalledTimes(20);
  });

  it('limits token revocation to 10 requests/minute', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/auth/token/revoke')
        .send({ refreshToken: 'example-token' })
        .expect(204);
    }

    await request(app.getHttpServer())
      .post('/auth/token/revoke')
      .send({ refreshToken: 'example-token' })
      .expect(429);

    expect(tokens.revoke).toHaveBeenCalledTimes(10);
  });
});
