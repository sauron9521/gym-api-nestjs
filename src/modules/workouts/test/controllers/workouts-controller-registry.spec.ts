import { RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { WorkoutsController } from '../../controllers/workouts.controller.js';
import { WorkoutsModule } from '../../workouts.module.js';

describe('WorkoutsModule controller registry', () => {
  it('registers only the workouts controller at the existing prefix', () => {
    const controllers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      WorkoutsModule,
    );
    expect(controllers).toEqual([WorkoutsController]);
    expect(Reflect.getMetadata(PATH_METADATA, WorkoutsController)).toBe('workouts');
  });

  it.each([
    ['create', RequestMethod.POST, '/'],
    ['findMany', RequestMethod.GET, '/'],
    ['findOne', RequestMethod.GET, ':id'],
    ['update', RequestMethod.PATCH, ':id'],
    ['start', RequestMethod.POST, ':id/start'],
    ['updateSet', RequestMethod.PATCH, ':id/sets/:setId'],
    ['complete', RequestMethod.POST, ':id/complete'],
    ['cancel', RequestMethod.POST, ':id/cancel'],
    ['createFromProgram', RequestMethod.POST, 'from-program'],
  ] as const)('preserves %s HTTP method and path', (name, method, path) => {
    const handler = WorkoutsController.prototype[name];
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
  });

  it('preserves 200 for lifecycle transitions and default 201 for creation', () => {
    const controller = WorkoutsController.prototype;
    for (const name of ['start', 'complete', 'cancel'] as const) {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller[name])).toBe(200);
    }
    for (const name of ['create', 'createFromProgram'] as const) {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller[name]))
        .toBeUndefined();
    }
  });

  it('registers nine unique verb/path pairs', () => {
    const routes = Object.getOwnPropertyNames(WorkoutsController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const handler = Object.getOwnPropertyDescriptor(
          WorkoutsController.prototype,
          name,
        )?.value as (...args: unknown[]) => unknown;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        return `${method}:workouts/${path}`;
      });
    expect(routes).toHaveLength(9);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
