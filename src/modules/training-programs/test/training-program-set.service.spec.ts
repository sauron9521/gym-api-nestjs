import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '#prisma/client';
import { TrainingProgramSetService } from '../services/training-program-set.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

describe('TrainingProgramSetService', () => {
  const repository = {
    createProgramSet: vi.fn(),
    updateProgramSet: vi.fn(),
    deleteProgramSet: vi.fn(),
    reorderProgramSets: vi.fn(),
  };
  const access = { assertEditableProgramExercise: vi.fn() };
  const actor: TrainingProgramActor = { id: 'trainer-1', role: 'TRAINER' };
  const ids = ['program-1', 'version-1', 'workout-1', 'exercise-1'] as const;
  const exercise = () => ({
    sets: [
      { id: 'set-1', setNumber: 1 },
      { id: 'set-2', setNumber: 4 },
    ],
  });
  const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError(
    'Concurrent update', { code, clientVersion: '7.10.1' },
  );
  let service: TrainingProgramSetService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new TrainingProgramSetService(repository as never, access as never);
    access.assertEditableProgramExercise.mockResolvedValue(exercise());
  });

  it('appends a set after the highest existing number, preserving all targets', async () => {
    const result = { id: 'version-1' };
    repository.createProgramSet.mockResolvedValue(result);
    const input = {
      setType: 'WARMUP' as const,
      plannedReps: 12,
      plannedWeightKg: 47.5,
      plannedDurationSeconds: 40,
      plannedDistanceMeters: 125.5,
      restSeconds: 90,
      targetRpe: 7.5,
      targetRir: 2,
      notes: 'Slow eccentric',
    };
    await expect(service.addSet(actor, ...ids, input)).resolves.toBe(result);
    expect(access.assertEditableProgramExercise).toHaveBeenCalledExactlyOnceWith(actor, ...ids);
    expect(repository.createProgramSet).toHaveBeenCalledExactlyOnceWith(
      ...ids, { setNumber: 5, ...input },
    );
  });

  it('defaults an initial set number, set type and nullable targets', async () => {
    access.assertEditableProgramExercise.mockResolvedValue({ sets: [] });
    await service.addSet(actor, ...ids, {});
    expect(repository.createProgramSet).toHaveBeenCalledExactlyOnceWith(
      ...ids, {
        setNumber: 1,
        setType: 'WORKING',
        plannedReps: null,
        plannedWeightKg: null,
        plannedDurationSeconds: null,
        plannedDistanceMeters: null,
        restSeconds: null,
        targetRpe: null,
        targetRir: null,
        notes: null,
      },
    );
  });

  it.each(['P2002', 'P2025'] as const)(
    'maps a concurrent add %s to conflict', async (code) => {
      repository.createProgramSet.mockRejectedValue(prismaError(code));
      await expect(service.addSet(actor, ...ids, {}))
        .rejects.toBeInstanceOf(ConflictException);
    },
  );

  it('never creates a set when edit access is denied', async () => {
    access.assertEditableProgramExercise.mockRejectedValue(new ForbiddenException());
    await expect(service.addSet(actor, ...ids, {}))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.createProgramSet).not.toHaveBeenCalled();
  });

  it('rejects an empty update before checking nested access', async () => {
    await expect(service.updateSet(actor, ...ids, 'set-1', {}))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(access.assertEditableProgramExercise).not.toHaveBeenCalled();
  });

  it('hides a set not in the selected program exercise', async () => {
    await expect(service.updateSet(actor, ...ids, 'foreign', { plannedReps: 10 }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(repository.updateProgramSet).not.toHaveBeenCalled();
  });

  it('updates a known set and returns the repository projection', async () => {
    const result = { id: 'version-1' };
    repository.updateProgramSet.mockResolvedValue(result);
    await expect(service.updateSet(actor, ...ids, 'set-2', {
      plannedWeightKg: 60.25,
    })).resolves.toBe(result);
    expect(repository.updateProgramSet).toHaveBeenCalledExactlyOnceWith(
      ...ids, 'set-2', { plannedWeightKg: 60.25 },
    );
  });

  it('maps a published-draft race on update to conflict', async () => {
    repository.updateProgramSet.mockRejectedValue(prismaError('P2025'));
    await expect(service.updateSet(actor, ...ids, 'set-1', { notes: 'x' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('never deletes a foreign set', async () => {
    await expect(service.removeSet(actor, ...ids, 'foreign'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(repository.deleteProgramSet).not.toHaveBeenCalled();
  });

  it('deletes a known set', async () => {
    const result = { id: 'version-1' };
    repository.deleteProgramSet.mockResolvedValue(result);
    await expect(service.removeSet(actor, ...ids, 'set-1')).resolves.toBe(result);
    expect(repository.deleteProgramSet).toHaveBeenCalledExactlyOnceWith(...ids, 'set-1');
  });

  it('maps a published-draft race on delete to conflict', async () => {
    repository.deleteProgramSet.mockRejectedValue(prismaError('P2025'));
    await expect(service.removeSet(actor, ...ids, 'set-1'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    { setIds: [] as string[] },
    { setIds: ['set-1'] },
    { setIds: ['set-1', 'set-1'] },
    { setIds: ['set-1', 'foreign'] },
  ])('rejects incomplete, duplicate or foreign set order %j', async ({ setIds }) => {
    await expect(service.reorderSets(actor, ...ids, { setIds }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.reorderProgramSets).not.toHaveBeenCalled();
  });

  it('accepts an exact permutation and delegates to the repository', async () => {
    const result = { id: 'version-1' };
    repository.reorderProgramSets.mockResolvedValue(result);
    const setIds = ['set-2', 'set-1'];
    await expect(service.reorderSets(actor, ...ids, { setIds })).resolves.toBe(result);
    expect(repository.reorderProgramSets).toHaveBeenCalledExactlyOnceWith(...ids, setIds);
  });

  it('reports a stale reorder as bad request', async () => {
    repository.reorderProgramSets.mockRejectedValue(new Error('INVALID_SET_ORDER'));
    await expect(service.reorderSets(actor, ...ids, {
      setIds: ['set-2', 'set-1'],
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports a stale draft during reorder as conflict', async () => {
    repository.reorderProgramSets.mockRejectedValue(prismaError('P2025'));
    await expect(service.reorderSets(actor, ...ids, {
      setIds: ['set-2', 'set-1'],
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not hide unexpected repository errors', async () => {
    const error = new Error('database unavailable');
    repository.createProgramSet.mockRejectedValue(error);
    await expect(service.addSet(actor, ...ids, {})).rejects.toBe(error);
  });
});
