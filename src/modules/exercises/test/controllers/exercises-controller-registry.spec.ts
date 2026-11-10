import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { ExercisesController } from '../../controllers/exercises.controller.js';
import { ExerciseTrainerAccessController } from '../../controllers/exercise-trainer-access.controller.js';
import { ExercisesModule } from '../../exercises.module.js';

describe('ExercisesModule controller registry', () => {
  const controllers = [ExercisesController, ExerciseTrainerAccessController];

  it('keeps controller order and both route prefixes', () => {
    const registered: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      ExercisesModule,
    );
    expect(registered).toEqual(controllers);
    expect(Reflect.getMetadata(PATH_METADATA, ExercisesController)).toBe('exercises');
    expect(Reflect.getMetadata(PATH_METADATA, ExerciseTrainerAccessController))
      .toBe('exercises/:id/trainer-access');
  });

  it('registers exactly eight unique HTTP verb/path combinations', () => {
    const routes = controllers.flatMap((controller) => {
      const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
      return Object.getOwnPropertyNames(controller.prototype)
        .filter((name) => name !== 'constructor')
        .map((name) => {
          const action = Object.getOwnPropertyDescriptor(controller.prototype, name)
            ?.value as (...args: unknown[]) => unknown;
          const method = Reflect.getMetadata(METHOD_METADATA, action) as RequestMethod | undefined;
          const path = Reflect.getMetadata(PATH_METADATA, action) as string | undefined;
          expect(method, `Missing method on ${controller.name}.${name}`).toBeDefined();
          expect(path, `Missing path on ${controller.name}.${name}`).toBeDefined();
          return `${method}:${prefix}/${path}`;
        });
    });
    expect(routes).toHaveLength(8);
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes).toContain(`${RequestMethod.GET}:exercises/:id`);
    expect(routes).toContain(`${RequestMethod.DELETE}:exercises/:id/trainer-access/:trainerId`);
  });
});
