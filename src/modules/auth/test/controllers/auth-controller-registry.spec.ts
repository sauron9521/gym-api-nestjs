import { RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { AuthController } from '../../controllers/auth.controller.js';
import { PasswordResetController } from '../../controllers/password-reset.controller.js';
import { EmailVerificationController } from '../../controllers/email-verification.controller.js';
import { TokensController } from '../../controllers/tokens.controller.js';
import { SessionsController } from '../../controllers/sessions.controller.js';
import { AuthNoStoreInterceptor } from '../../interceptors/auth-no-store.interceptor.js';
import { AuthModule } from '../../auth.module.js';

describe('AuthModule controller registry', () => {
  const controllers = [
    AuthController,
    PasswordResetController,
    EmailVerificationController,
    TokensController,
    SessionsController,
  ];

  it('preserves controller registration and five route prefixes', () => {
    const registered: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      AuthModule,
    );
    expect(registered).toEqual(controllers);
    expect(controllers.map((controller) =>
      Reflect.getMetadata(PATH_METADATA, controller),
    )).toEqual([
      'auth',
      'auth/password-reset',
      'auth/email',
      'auth/token',
      'auth',
    ]);
  });

  it.each([
    [AuthController, 'signUp', RequestMethod.POST, 'register', undefined],
    [AuthController, 'signIn', RequestMethod.POST, 'login', 200],
    [PasswordResetController, 'forgot', RequestMethod.POST, 'forgot', 202],
    [PasswordResetController, 'reset', RequestMethod.POST, 'reset', 200],
    [EmailVerificationController, 'verifyEmail', RequestMethod.POST, 'verify', 200],
    [EmailVerificationController, 'resend', RequestMethod.POST, 'verification', 202],
    [TokensController, 'issue', RequestMethod.POST, '/', 200],
    [TokensController, 'refresh', RequestMethod.POST, 'refresh', 200],
    [TokensController, 'revoke', RequestMethod.POST, 'revoke', 204],
    [SessionsController, 'list', RequestMethod.GET, 'sessions', undefined],
    [SessionsController, 'revoke', RequestMethod.DELETE, 'sessions/:id', 204],
    [SessionsController, 'signOut', RequestMethod.POST, 'sign-out', 204],
    [SessionsController, 'signOutEverywhere', RequestMethod.POST, 'sign-out-everywhere', 204],
  ] as const)('preserves %s.%s HTTP contract', (controller, name, method, path, code) => {
    const handler = Object.getOwnPropertyDescriptor(
      controller.prototype,
      name,
    )?.value as (...args: unknown[]) => unknown;

    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(code);
  });

  it.each([
    [AuthController, 'signUp', 3],
    [AuthController, 'signIn', 3],
    [PasswordResetController, 'forgot', 3],
    [PasswordResetController, 'reset', 3],
    [EmailVerificationController, 'verifyEmail', 8],
    [EmailVerificationController, 'resend', 3],
    [TokensController, 'issue', 3],
    [TokensController, 'refresh', 20],
    [TokensController, 'revoke', 10],
  ] as const)('retains %s.%s rate limit', (controller, name, limit) => {
    const handler = Object.getOwnPropertyDescriptor(
      controller.prototype,
      name,
    )?.value as (...args: unknown[]) => unknown;

    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(limit);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });

  it('retains the no-store interceptor on all five controllers', () => {
    for (const controller of controllers) {
      const interceptors: unknown[] = Reflect.getMetadata(
        INTERCEPTORS_METADATA,
        controller,
      );
      expect(interceptors).toContain(AuthNoStoreInterceptor);
    }
  });

  it('registers exactly thirteen unique HTTP verb/path pairs', () => {
    const routes = controllers.flatMap((controller) => {
      const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
      return Object.getOwnPropertyNames(controller.prototype)
        .filter((name) => name !== 'constructor')
        .map((name) => {
          const handler = Object.getOwnPropertyDescriptor(
            controller.prototype,
            name,
          )?.value as (...args: unknown[]) => unknown;
          const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
          const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
          expect(method, `Missing HTTP method on ${controller.name}.${name}`).toBeDefined();
          expect(path, `Missing HTTP path on ${controller.name}.${name}`).toBeDefined();
          return `${method}:${prefix}/${path}`;
        });
    });

    expect(routes).toHaveLength(13);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
