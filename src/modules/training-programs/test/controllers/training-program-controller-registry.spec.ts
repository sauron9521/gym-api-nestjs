import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { TrainingProgramAssignmentsController } from '../../controllers/training-program-assignments.controller.js';
import { TrainingProgramVersionsController } from '../../controllers/training-program-versions.controller.js';
import { TrainingProgramWorkoutsController } from '../../controllers/training-program-workouts.controller.js';
import { TrainingProgramExercisesController } from '../../controllers/training-program-exercises.controller.js';
import { TrainingProgramSetsController } from '../../controllers/training-program-sets.controller.js';
import { TrainingProgramsController } from '../../controllers/training-programs.controller.js';
import { TrainingProgramsModule } from '../../training-programs.module.js';

describe('TrainingProgramsModule controller registry', () => {
  const expectedControllers = [
    TrainingProgramAssignmentsController,
    TrainingProgramVersionsController,
    TrainingProgramWorkoutsController,
    TrainingProgramExercisesController,
    TrainingProgramSetsController,
    TrainingProgramsController,
  ];

  it('preserves the complete controller registration order', () => {
    const controllers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      TrainingProgramsModule,
    );
    expect(controllers).toEqual(expectedControllers);
  });

  it('exposes exactly 25 unique HTTP method/path pairs', () => {
    const routes = expectedControllers.flatMap((controller) => {
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
          expect(method, `Missing HTTP method for ${controller.name}.${name}`).toBeDefined();
          expect(path, `Missing HTTP path for ${controller.name}.${name}`).toBeDefined();
          return `${method}:${base}/${path}`;
        });
    });
    expect(routes).toHaveLength(25);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
