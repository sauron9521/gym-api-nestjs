import { Test, TestingModule } from '@nestjs/testing';
import {
  EmailVerificationService,
  SignInService,
} from '@nestjs/authentication';
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from '../../controllers/index.js';
import { CredentialsService } from '../../services/index.js';

describe('AuthController', () => {
  let controller: AuthController;

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

    const module: TestingModule = await Test.createTestingModule({
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

    controller = module.get<AuthController>(AuthController);
  });

  describe('singUp', () => {
    it('should register a user, create a session and send verification email', async () => {
      const input = {
        email: 'test@example.com',
        password: 'StrongPassword123!',
      };

      const user = {
        id: 'user-1',
        email: input.email,
      };

      credentialsService.registry.mockResolvedValue(user);
      signInService.signIn.mockResolvedValue({});
      emailVerificationService.send.mockResolvedValue(undefined);

      const result = await controller.singUp(input);

      expect(credentialsService.registry).toHaveBeenCalledWith(input);
      expect(signInService.signIn).toHaveBeenCalledWith('user-1', {
        method: 'password',
      });
      expect(emailVerificationService.send).toHaveBeenCalledWith(user);
      expect(result).toEqual(user);
    });
  });

  describe('singIn', () => {
    it('should return mfaRequired when credentials are valid', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
      };

      credentialsService.verify.mockResolvedValue(user);
      signInService.signIn.mockResolvedValue({
        session: { mfa: 'pending' },
      });

      const result = await controller.singIn({
        email: 'test@example.com',
        password: 'StrongPassword123!',
      });

      expect(credentialsService.verify).toHaveBeenCalledWith(
        'test@example.com',
        'StrongPassword123!',
      );
      expect(signInService.signIn).toHaveBeenCalledWith('user-1', {
        method: 'password',
      });
      expect(result).toEqual({ mfaRequired: true });
    });

    it('should throw UnauthorizedException when credentials are invalid', async () => {
      credentialsService.verify.mockResolvedValue(null);

      await expect(
        controller.singIn({
          email: 'test@example.com',
          password: 'WrongPassword123!',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(signInService.signIn).not.toHaveBeenCalled();
    });
  });
});
