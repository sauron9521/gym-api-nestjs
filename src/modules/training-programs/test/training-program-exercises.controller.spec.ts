import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { TrainingProgramExercisesController } from '../training-program-exercises.controller.js';
import { TrainingProgramWorkoutsController } from '../training-program-workouts.controller.js';
import { TrainingProgramsController } from '../training-programs.controller.js';
import { TrainingProgramsModule } from '../training-programs.module.js';
import { TrainingProgramsService } from '../services/training-programs.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

describe('TrainingProgramExercisesController', () => {
  const service = {
    addExercise: vi.fn(),
    reorderExercises: vi.fn(),
    updateExercise: vi.fn(),
    removeExercise: vi.fn(),
  };
  const actor: TrainingProgramActor = { id: 'trainer-1', role: 'TRAINER' };
  let controller: TrainingProgramExercisesController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new TrainingProgramExercisesController(
      service as unknown as TrainingProgramsService,
    );
  });

  it('should add an exercise', async () => {
    const body = {
      exerciseId: 'exercise-1',
      notes: 'Keep controlled tempo',
    };

    service.addExercise.mockResolvedValue({ id: 'program-exercise-1' });

    await controller.addExercise(
      'program-1',
      'version-1',
      'workout-1',
      actor,
      body,
    );

    expect(service.addExercise).toHaveBeenCalledWith(
      actor,
      'program-1',
      'version-1',
      'workout-1',
      body,
    );
  });

  it('delegates exercise reordering with original input', async () => {
    const body = { exerciseIds: ['exercise-a', 'exercise-b'] };
    service.reorderExercises.mockResolvedValue({ id: 'version-1' });
    await controller.reorderExercises('program-1', 'version-1', 'workout-1', actor, body);
    expect(service.reorderExercises).toHaveBeenCalledWith(
      actor, 'program-1', 'version-1', 'workout-1', body,
    );
  });

  it('delegates exercise updates with all ids and actor', async () => {
    const body = { notes: 'Slow eccentric' };
    service.updateExercise.mockResolvedValue({ id: 'version-1' });
    await controller.updateExercise('program-1', 'version-1', 'workout-1', 'exercise-1', actor, body);
    expect(service.updateExercise).toHaveBeenCalledWith(
      actor, 'program-1', 'version-1', 'workout-1', 'exercise-1', body,
    );
  });

  it('delegates exercise removal without changing the actor', async () => {
    service.removeExercise.mockResolvedValue({ id: 'version-1' });
    await controller.removeExercise('program-1', 'version-1', 'workout-1', 'exercise-1', actor);
    expect(service.removeExercise).toHaveBeenCalledWith(
      actor, 'program-1', 'version-1', 'workout-1', 'exercise-1',
    );
  });

  it('keeps the controller registered ahead of the generic program handler', () => {
    const controllers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      TrainingProgramsModule,
    );
    expect(controllers.indexOf(TrainingProgramWorkoutsController))
      .toBeLessThan(controllers.indexOf(TrainingProgramExercisesController));
    expect(controllers.indexOf(TrainingProgramExercisesController))
      .toBeLessThan(controllers.indexOf(TrainingProgramsController));
    expect(Reflect.getMetadata(PATH_METADATA, TrainingProgramExercisesController))
      .toBe('training-programs');
  });

  it.each([
    ['addExercise', ':programId/versions/:versionId/workouts/:workoutId/exercises', RequestMethod.POST],
    ['reorderExercises', ':programId/versions/:versionId/workouts/:workoutId/exercises/reorder', RequestMethod.PATCH],
    ['updateExercise', ':programId/versions/:versionId/workouts/:workoutId/exercises/:exerciseId', RequestMethod.PATCH],
    ['removeExercise', ':programId/versions/:versionId/workouts/:workoutId/exercises/:exerciseId', RequestMethod.DELETE],
  ] as const)('preserves route metadata for %s', (handler, path, method) => {
    const action = TrainingProgramExercisesController.prototype[handler];
    expect(Reflect.getMetadata(PATH_METADATA, action)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, action)).toBe(method);
  });
});
