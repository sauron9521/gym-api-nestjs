import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { TrainingProgramWorkoutsController } from '../../controllers/training-program-workouts.controller.js';
import { TrainingProgramVersionsController } from '../../controllers/training-program-versions.controller.js';
import { TrainingProgramsController } from '../../controllers/training-programs.controller.js';
import { TrainingProgramsModule } from '../../training-programs.module.js';
import { TrainingProgramsService } from '../../services/training-programs.service.js';
import type { TrainingProgramActor } from '../../types/training-program.types.js';

describe('TrainingProgramWorkoutsController', () => {
  const service = {
    createWorkout: vi.fn(),
    updateWorkout: vi.fn(),
    deleteWorkout: vi.fn(),
  };
  const actor: TrainingProgramActor = { id: 'trainer-1', role: 'TRAINER' };
  let controller: TrainingProgramWorkoutsController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new TrainingProgramWorkoutsController(
      service as unknown as TrainingProgramsService,
    );
  });

  it('delegates workout creation with actor and original DTO', async () => {
    const body = { title: 'Upper body', weekNumber: 1, dayNumber: 1 };
    const created = { id: 'workout-1' };
    service.createWorkout.mockResolvedValue(created);

    await expect(controller.createWorkout('program-1', 'version-1', actor, body))
      .resolves.toBe(created);
    expect(service.createWorkout).toHaveBeenCalledWith(
      actor, 'program-1', 'version-1', body,
    );
  });

  it('delegates workout update with all identifiers and DTO', async () => {
    const body = { title: 'Updated upper body' };
    service.updateWorkout.mockResolvedValue({ id: 'workout-1', ...body });

    await expect(controller.updateWorkout('program-1', 'version-1', 'workout-1', actor, body))
      .resolves.toMatchObject(body);
    expect(service.updateWorkout).toHaveBeenCalledWith(
      actor, 'program-1', 'version-1', 'workout-1', body,
    );
  });

  it('delegates workout removal without losing actor scope', async () => {
    service.deleteWorkout.mockResolvedValue({ id: 'workout-1' });

    await expect(controller.deleteWorkout('program-1', 'version-1', 'workout-1', actor))
      .resolves.toEqual({ id: 'workout-1' });
    expect(service.deleteWorkout).toHaveBeenCalledWith(
      actor, 'program-1', 'version-1', 'workout-1',
    );
  });

  it('registers before generic program routes with the same route prefix', () => {
    const registered: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      TrainingProgramsModule,
    );
    expect(registered.indexOf(TrainingProgramVersionsController))
      .toBeLessThan(registered.indexOf(TrainingProgramWorkoutsController));
    expect(registered.indexOf(TrainingProgramWorkoutsController))
      .toBeLessThan(registered.indexOf(TrainingProgramsController));
    expect(Reflect.getMetadata(PATH_METADATA, TrainingProgramWorkoutsController))
      .toBe('training-programs');
  });

  it.each([
    ['createWorkout', ':programId/versions/:versionId/workouts', RequestMethod.POST],
    ['updateWorkout', ':programId/versions/:versionId/workouts/:workoutId', RequestMethod.PATCH],
    ['deleteWorkout', ':programId/versions/:versionId/workouts/:workoutId', RequestMethod.DELETE],
  ] as const)('preserves method and path for %s', (handler, path, method) => {
    const action = TrainingProgramWorkoutsController.prototype[handler];
    expect(Reflect.getMetadata(PATH_METADATA, action)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, action)).toBe(method);
  });
});
