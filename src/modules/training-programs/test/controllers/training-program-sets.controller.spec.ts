import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { TrainingProgramSetsController } from '../../controllers/training-program-sets.controller.js';
import { TrainingProgramExercisesController } from '../../controllers/training-program-exercises.controller.js';
import { TrainingProgramsController } from '../../controllers/training-programs.controller.js';
import { TrainingProgramsModule } from '../../training-programs.module.js';
import { TrainingProgramsService } from '../../services/training-programs.service.js';
import type { TrainingProgramActor } from '../../types/training-program.types.js';

describe('TrainingProgramSetsController', () => {
  const service = {
    addSet: vi.fn(),
    reorderSets: vi.fn(),
    updateSet: vi.fn(),
    removeSet: vi.fn(),
  };
  const actor: TrainingProgramActor = { id: 'trainer-1', role: 'TRAINER' };
  let controller: TrainingProgramSetsController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new TrainingProgramSetsController(
      service as unknown as TrainingProgramsService,
    );
  });

  it('should add a set', async () => {
    const body = {
      setType: 'WORKING' as const,
      plannedReps: 10,
      plannedWeightKg: 60,
    };

    service.addSet.mockResolvedValue({ id: 'set-1' });

    await controller.addSet(
      'program-1',
      'version-1',
      'workout-1',
      'exercise-1',
      actor,
      body,
    );

    expect(service.addSet).toHaveBeenCalledWith(
      actor,
      'program-1',
      'version-1',
      'workout-1',
      'exercise-1',
      body,
    );
  });

  it('delegates set reordering and preserves actor and identifiers', async () => {
    const body = { setIds: [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ] };
    const result = { id: 'version-1' };
    service.reorderSets.mockResolvedValue(result);

    await expect(controller.reorderSets('program-1', 'version-1', 'workout-1', 'exercise-1', actor, body))
      .resolves.toBe(result);
    expect(service.reorderSets).toHaveBeenCalledWith(
      actor, 'program-1', 'version-1', 'workout-1', 'exercise-1', body,
    );
  });

  it('delegates set updates without modifying DTO', async () => {
    const body = { plannedReps: 8, notes: 'Increase load next week' };
    const result = { id: 'version-1' };
    service.updateSet.mockResolvedValue(result);

    await expect(controller.updateSet('program-1', 'version-1', 'workout-1', 'exercise-1', 'set-1', actor, body))
      .resolves.toBe(result);
    expect(service.updateSet).toHaveBeenCalledWith(
      actor, 'program-1', 'version-1', 'workout-1', 'exercise-1', 'set-1', body,
    );
  });

  it('delegates set removal preserving the actor scope', async () => {
    const result = { id: 'version-1' };
    service.removeSet.mockResolvedValue(result);

    await expect(controller.removeSet('program-1', 'version-1', 'workout-1', 'exercise-1', 'set-1', actor))
      .resolves.toBe(result);
    expect(service.removeSet).toHaveBeenCalledWith(
      actor, 'program-1', 'version-1', 'workout-1', 'exercise-1', 'set-1',
    );
  });

  it('registers before the generic controller and retains the route prefix', () => {
    const controllers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      TrainingProgramsModule,
    );
    expect(controllers.indexOf(TrainingProgramExercisesController))
      .toBeLessThan(controllers.indexOf(TrainingProgramSetsController));
    expect(controllers.indexOf(TrainingProgramSetsController))
      .toBeLessThan(controllers.indexOf(TrainingProgramsController));
    expect(Reflect.getMetadata(PATH_METADATA, TrainingProgramSetsController))
      .toBe('training-programs');
  });

  it.each([
    ['addSet', ':programId/versions/:versionId/workouts/:workoutId/exercises/:exerciseId/sets', RequestMethod.POST],
    ['reorderSets', ':programId/versions/:versionId/workouts/:workoutId/exercises/:exerciseId/sets/reorder', RequestMethod.PATCH],
    ['updateSet', ':programId/versions/:versionId/workouts/:workoutId/exercises/:exerciseId/sets/:setId', RequestMethod.PATCH],
    ['removeSet', ':programId/versions/:versionId/workouts/:workoutId/exercises/:exerciseId/sets/:setId', RequestMethod.DELETE],
  ] as const)('preserves HTTP method and path for %s', (handler, path, method) => {
    const action = TrainingProgramSetsController.prototype[handler];
    expect(Reflect.getMetadata(PATH_METADATA, action)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, action)).toBe(method);
  });
});
