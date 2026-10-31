import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import {
  EmailVerificationService,
  SignInService,
} from '@nestjs/authentication';
import request from 'supertest';

import { AuthController } from '../src/modules/auth/controllers/index.js';
import { CredentialsService } from '../src/modules/auth/services/index.js';

describe('AuthController (HTTP)', () => {
  let app: INestApplication;

  const credentialsService = {
    registry: vi.fn(),
    verify: vi.fn(),
  };

  const signInService = {
    signIn: vi.fn(),
  };

  const emailVerificationService = {
    send: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: CredentialsService,
          useValue: credentialsService,
        },
        {
          provide: SignInService,
          useValue: signInService,
        },
        {
          provide: EmailVerificationService,
          useValue: emailVerificationService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /auth/login', () => {
    it('should return 200 when credentials are valid', async () => {
      credentialsService.verify.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });

      signInService.signIn.mockResolvedValue({
        session: { mfa: 'none' },
      });

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'StrongPassword123!',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ mfaRequired: false });

      expect(credentialsService.verify).toHaveBeenCalledWith(
        'test@example.com',
        'StrongPassword123!',
      );

      expect(signInService.signIn).toHaveBeenCalledWith('user-1', {
        method: 'password',
      });
    });

    it('should return 401 when credentials are invalid', async () => {
      credentialsService.verify.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword123!',
        });

      expect(response.status).toBe(401);

      expect(response.body.message).toBe(
        'Invalid credentials! Wrong email or password.',
      );

      expect(signInService.signIn).not.toHaveBeenCalled();
    });

    it('should return 400 when email is invalid', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'not-an-email',
          password: 'StrongPassword123!',
        });

      expect(response.status).toBe(400);
      expect(credentialsService.verify).not.toHaveBeenCalled();
    });

    it('should return 400 when password is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'test@example.com',
        });

      expect(response.status).toBe(400);
      expect(credentialsService.verify).not.toHaveBeenCalled();
    });

    it('should return 400 when an unexpected field is provided', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'StrongPassword123!',
          role: 'admin',
        });

      expect(response.status).toBe(400);
      expect(credentialsService.verify).not.toHaveBeenCalled();
    });
  });
});
