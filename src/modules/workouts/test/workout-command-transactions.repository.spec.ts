import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '#src/infra/database/index';
import { workoutSelect, workoutSetSelect } from '../selects/workout.select.js';
import { WorkoutLifecycleRepository } from '../repositories/workout-lifecycle.repository.js';
import { WorkoutSetsRepository } from '../repositories/workout-sets.repository.js';

describe('Workout command repository transaction boundaries', () => {
  const tx = {
    $queryRaw: vi.fn(),
    workoutSet: { update: vi.fn(), findMany: vi.fn() },
    workout: { update: vi.fn() },
  };
  const prisma = { $transaction: vi.fn() };
  const setsRepository = new WorkoutSetsRepository(
    prisma as unknown as PrismaService,
  );
  const lifecycleRepository = new WorkoutLifecycleRepository(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
  });

  it('locks the parent workout before updating an in-progress set', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'workout-1', status: 'IN_PROGRESS' }]);
    tx.workoutSet.update.mockResolvedValue({ id: 'set-1', status: 'COMPLETED' });
    const data = { status: 'COMPLETED' as const };

    await expect(setsRepository.updateSet('set-1', data)).resolves.toEqual({
      id: 'set-1',
      status: 'COMPLETED',
    });

    expect(tx.workoutSet.update).toHaveBeenCalledWith({
      where: { id: 'set-1' },
      data,
      select: workoutSetSelect,
    });
    expect(tx.$queryRaw.mock.calls[0]?.[0].join('?')).toContain('FOR UPDATE OF w');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.workoutSet.update.mock.invocationCallOrder[0]!,
    );
  });

  it('does not update sets when their parent is not in progress', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'workout-1', status: 'COMPLETED' }]);

    await expect(setsRepository.updateSet('set-1', { status: 'COMPLETED' }))
      .resolves.toBeNull();
    expect(tx.workoutSet.update).not.toHaveBeenCalled();
  });

  it('refuses completion while a set is pending after acquiring the parent lock', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'workout-1', status: 'IN_PROGRESS' }]);
    tx.workoutSet.findMany.mockResolvedValue([
      { status: 'COMPLETED' },
      { status: 'PENDING' },
    ]);

    await expect(lifecycleRepository.completeWorkout({
      id: 'workout-1',
      athleteId: 'athlete-1',
      completedAt: new Date('2030-01-01T10:00:00Z'),
    })).resolves.toEqual({ status: 'INVALID_SETS' });

    expect(tx.workout.update).not.toHaveBeenCalled();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.workoutSet.findMany.mock.invocationCallOrder[0]!,
    );
  });

  it('completes only after rereading processed sets under the lock', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'workout-1', status: 'IN_PROGRESS' }]);
    tx.workoutSet.findMany.mockResolvedValue([{ status: 'COMPLETED' }]);
    tx.workout.update.mockResolvedValue({ id: 'workout-1', status: 'COMPLETED' });
    const completedAt = new Date('2030-01-01T10:00:00Z');

    await expect(lifecycleRepository.completeWorkout({
      id: 'workout-1',
      athleteId: 'athlete-1',
      completedAt,
    })).resolves.toMatchObject({
      status: 'COMPLETED',
      workout: { id: 'workout-1', status: 'COMPLETED' },
    });

    expect(tx.workout.update).toHaveBeenCalledWith({
      where: { id: 'workout-1', athleteId: 'athlete-1', status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED', completedAt },
      select: workoutSelect,
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.workoutSet.findMany.mock.invocationCallOrder[0]!,
    );
    expect(tx.workoutSet.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.workout.update.mock.invocationCallOrder[0]!,
    );
  });
});
