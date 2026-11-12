import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '#prisma/client';
import { TrainingProgramExerciseService } from '../services/training-program-exercise.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

describe('TrainingProgramExerciseService', () => {
  const repository = {
    createProgramExercise: vi.fn(),
    updateProgramExercise: vi.fn(),
    deleteProgramExercise: vi.fn(),
    reorderProgramExercises: vi.fn(),
  };
  const library = { findAvailableForTrainingProgram: vi.fn() };
  const access = { assertEditableWorkout: vi.fn() };
  const actor: TrainingProgramActor = { id: 'trainer-1', role: 'TRAINER' };
  const ids = ['program-1', 'version-1', 'workout-1'] as const;
  const workout = () => ({
    exercises: [
      { id: 'program-exercise-1', sortOrder: 0 },
      { id: 'program-exercise-2', sortOrder: 3 },
    ],
  });
  const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError(
    'Concurrent update', { code, clientVersion: '7.10.1' },
  );
  let service: TrainingProgramExerciseService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new TrainingProgramExerciseService(
      repository as never, library as never, access as never,
    );
    access.assertEditableWorkout.mockResolvedValue(workout());
    library.findAvailableForTrainingProgram.mockResolvedValue({
      id: 'library-exercise', name: 'Bench', exerciseType: 'STRENGTH',
    });
  });

  it('appends a snapshot after the largest existing sort order', async () => {
    const result = { id: 'version-1' };
    repository.createProgramExercise.mockResolvedValue(result);
    await expect(service.addExercise(actor, ...ids, {
      exerciseId: 'library-exercise', notes: 'Paused',
    })).resolves.toBe(result);
    expect(access.assertEditableWorkout).toHaveBeenCalledExactlyOnceWith(actor, ...ids);
    expect(library.findAvailableForTrainingProgram)
      .toHaveBeenCalledExactlyOnceWith('library-exercise', actor);
    expect(repository.createProgramExercise).toHaveBeenCalledExactlyOnceWith(
      ...ids, {
        exerciseId: 'library-exercise', exerciseNameSnapshot: 'Bench',
        exerciseTypeSnapshot: 'STRENGTH', sortOrder: 4, notes: 'Paused',
      },
    );
  });

  it('starts numbering from zero when no exercises exist', async () => {
    access.assertEditableWorkout.mockResolvedValue({ exercises: [] });
    await service.addExercise(actor, ...ids, { exerciseId: 'library-exercise' });
    expect(repository.createProgramExercise).toHaveBeenCalledWith(
      ...ids, expect.objectContaining({ sortOrder: 0, notes: null }),
    );
  });

  it('denies an unavailable library exercise before writing', async () => {
    library.findAvailableForTrainingProgram.mockRejectedValue(new NotFoundException());
    await expect(service.addExercise(actor, ...ids, { exerciseId: 'secret' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(repository.createProgramExercise).not.toHaveBeenCalled();
  });

  it.each(['P2002', 'P2025'] as const)(
    'maps create %s to conflict', async (code) => {
      repository.createProgramExercise.mockRejectedValue(prismaError(code));
      await expect(service.addExercise(actor, ...ids, { exerciseId: 'library-exercise' }))
        .rejects.toBeInstanceOf(ConflictException);
    },
  );

  it('rejects an empty update without looking up private resources', async () => {
    await expect(service.updateExercise(actor, ...ids, 'program-exercise-1', {}))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(access.assertEditableWorkout).not.toHaveBeenCalled();
  });

  it('hides a program exercise not in the selected workout', async () => {
    await expect(service.updateExercise(actor, ...ids, 'foreign', { notes: 'x' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(repository.updateProgramExercise).not.toHaveBeenCalled();
  });

  it('updates only an exercise of the editable workout', async () => {
    const result = { id: 'version-1' };
    repository.updateProgramExercise.mockResolvedValue(result);
    await expect(service.updateExercise(actor, ...ids, 'program-exercise-1', {
      notes: null,
    })).resolves.toBe(result);
    expect(repository.updateProgramExercise).toHaveBeenCalledExactlyOnceWith(
      ...ids, 'program-exercise-1', { notes: null },
    );
  });

  it('maps a concurrent update to conflict', async () => {
    repository.updateProgramExercise.mockRejectedValue(prismaError('P2025'));
    await expect(service.updateExercise(actor, ...ids, 'program-exercise-1', {
      notes: 'x',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('hides unknown exercises on deletion', async () => {
    await expect(service.removeExercise(actor, ...ids, 'foreign'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(repository.deleteProgramExercise).not.toHaveBeenCalled();
  });

  it('deletes a known exercise from the editable workout', async () => {
    const result = { id: 'version-1' };
    repository.deleteProgramExercise.mockResolvedValue(result);
    await expect(service.removeExercise(actor, ...ids, 'program-exercise-2'))
      .resolves.toBe(result);
    expect(repository.deleteProgramExercise)
      .toHaveBeenCalledExactlyOnceWith(...ids, 'program-exercise-2');
  });

  it('maps a concurrent deletion to conflict', async () => {
    repository.deleteProgramExercise.mockRejectedValue(prismaError('P2025'));
    await expect(service.removeExercise(actor, ...ids, 'program-exercise-1'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    { exerciseIds: [] as string[] },
    { exerciseIds: ['program-exercise-1'] },
    { exerciseIds: ['program-exercise-1', 'program-exercise-1'] },
    { exerciseIds: ['program-exercise-1', 'foreign'] },
  ])('rejects an incomplete, duplicate or foreign reorder %j', async ({ exerciseIds }) => {
    await expect(service.reorderExercises(actor, ...ids, { exerciseIds }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.reorderProgramExercises).not.toHaveBeenCalled();
  });

  it('reorders exactly the exercises of the selected workout', async () => {
    const result = { id: 'version-1' };
    repository.reorderProgramExercises.mockResolvedValue(result);
    const exerciseIds = ['program-exercise-2', 'program-exercise-1'];
    await expect(service.reorderExercises(actor, ...ids, { exerciseIds }))
      .resolves.toBe(result);
    expect(repository.reorderProgramExercises)
      .toHaveBeenCalledExactlyOnceWith(...ids, exerciseIds);
  });

  it('maps a stale order to 400', async () => {
    repository.reorderProgramExercises.mockRejectedValue(new Error('INVALID_EXERCISE_ORDER'));
    await expect(service.reorderExercises(actor, ...ids, {
      exerciseIds: ['program-exercise-2', 'program-exercise-1'],
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps a published-draft race to 409 during reorder', async () => {
    repository.reorderProgramExercises.mockRejectedValue(prismaError('P2025'));
    await expect(service.reorderExercises(actor, ...ids, {
      exerciseIds: ['program-exercise-2', 'program-exercise-1'],
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not bypass draft access for a non-owner', async () => {
    access.assertEditableWorkout.mockRejectedValue(new ForbiddenException());
    await expect(service.reorderExercises(actor, ...ids, { exerciseIds: [] }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.reorderProgramExercises).not.toHaveBeenCalled();
  });

  it('preserves unexpected errors for diagnostics', async () => {
    const error = new Error('database offline');
    repository.updateProgramExercise.mockRejectedValue(error);
    await expect(service.updateExercise(actor, ...ids, 'program-exercise-1', {
      notes: 'x',
    })).rejects.toBe(error);
  });
});
