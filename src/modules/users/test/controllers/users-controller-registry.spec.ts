import { RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { UsersController } from '../../controllers/users.controller.js';
import { AvatarPublicController } from '../../controllers/avatar-public.controller.js';
import { UsersModule } from '../../users.module.js';

describe('UsersModule controller registry', () => {
  const controllers = [UsersController, AvatarPublicController];

  it('preserves controller registration order and both existing prefixes', () => {
    const registered: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      UsersModule,
    );
    expect(registered).toEqual(controllers);
    expect(Reflect.getMetadata(PATH_METADATA, UsersController)).toBe('users');
    expect(Reflect.getMetadata(PATH_METADATA, AvatarPublicController)).toBe('avatars');
  });

  it.each([
    [UsersController, 'me', RequestMethod.GET, 'me'],
    [UsersController, 'updateMe', RequestMethod.PATCH, 'me'],
    [UsersController, 'uploadAvatar', RequestMethod.POST, 'me/avatar'],
    [UsersController, 'deleteAvatar', RequestMethod.DELETE, 'me/avatar'],
    [AvatarPublicController, 'get', RequestMethod.GET, ':key'],
  ] as const)('preserves %s.%s HTTP method and route', (controller, name, method, path) => {
    const handler = Object.getOwnPropertyDescriptor(
      controller.prototype,
      name,
    )?.value as (...args: unknown[]) => unknown;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
  });

  it('preserves explicit 200 for avatar mutations and the 5/min rate limit', () => {
    const methods = UsersController.prototype;
    for (const method of [methods.uploadAvatar, methods.deleteAvatar]) {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, method)).toBe(200);
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', method)).toBe(5);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', method)).toBe(60_000);
    }
  });

  it('has five unique HTTP method/path pairs', () => {
    const routes = controllers.flatMap((controller) => {
      const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
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
          expect(path, `Missing HTTP route on ${controller.name}.${name}`).toBeDefined();
          return `${method}:${base}/${path}`;
        });
    });
    expect(routes).toHaveLength(5);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
