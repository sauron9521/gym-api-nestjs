import { RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { TrainerAthletesController } from '../../controllers/trainer-athletes.controller.js';
import { TrainerAthletesModule } from '../../trainer-athletes.module.js';

describe('TrainerAthletesModule controller registry', () => {
  it('registers exactly the relationship controller and preserves the route prefix', () => {
    const controllers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      TrainerAthletesModule,
    );
    expect(controllers).toEqual([TrainerAthletesController]);
    expect(Reflect.getMetadata(PATH_METADATA, TrainerAthletesController))
      .toBe('trainer-athletes');
  });

  it.each([
    ['create', RequestMethod.POST, '/'],
    ['findMany', RequestMethod.GET, '/'],
    ['findOne', RequestMethod.GET, ':id'],
    ['accept', RequestMethod.POST, ':id/accept'],
    ['decline', RequestMethod.POST, ':id/decline'],
    ['cancel', RequestMethod.POST, ':id/cancel'],
    ['terminate', RequestMethod.POST, ':id/terminate'],
  ] as const)('preserves %s route method and path', (handler, method, path) => {
    const action = TrainerAthletesController.prototype[handler];
    expect(Reflect.getMetadata(METHOD_METADATA, action)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, action)).toBe(path);
  });

  it('retains 201 for creation and explicit 200 statuses for transitions', () => {
    const controller = TrainerAthletesController.prototype;
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.create)).toBeUndefined();
    for (const handler of ['accept', 'decline', 'cancel', 'terminate'] as const) {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller[handler])).toBe(200);
    }
  });

  it('does not register duplicate method/path combinations', () => {
    const routes = Object.getOwnPropertyNames(TrainerAthletesController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const action = Object.getOwnPropertyDescriptor(TrainerAthletesController.prototype, name)
          ?.value as (...args: unknown[]) => unknown;
        const method = Reflect.getMetadata(METHOD_METADATA, action) as RequestMethod;
        const path = Reflect.getMetadata(PATH_METADATA, action) as string;
        return `${method}:trainer-athletes/${path}`;
      });
    expect(routes).toHaveLength(7);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
