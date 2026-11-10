import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '#src/infra/database/index';
import { ExerciseTrainerAccessRepository } from '../repositories/exercise-trainer-access.repository.js';

describe('ExerciseTrainerAccessRepository lock ordering', () => {
  const order: string[] = [];
  const tx = {
    $queryRaw: vi.fn(),
    exercise: { findFirst: vi.fn() },
    exerciseTrainerAccess: { upsert: vi.fn() },
  };
  const prisma = { $transaction: vi.fn() };
  const repository = new ExerciseTrainerAccessRepository(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    order.length = 0;
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => {
      const sql = parts.join('?');
      if (sql.includes('FROM trainer_athletes')) {
        order.push('relationship');
        return [{ id: 'relationship-1' }];
      }
      if (sql.includes('FROM exercises')) {
        order.push('exercise');
        return [{ id: 'exercise-1', visibility: 'SELECTED_TRAINERS' }];
      }
      throw new Error('Unexpected lock query');
    });
    tx.exerciseTrainerAccess.upsert.mockImplementation(async () => {
      order.push('grant');
      return {
        id: 'grant-1',
        exerciseId: 'exercise-1',
        trainerId: 'trainer-1',
        grantedAt: new Date(),
        revokedAt: null,
      };
    });
  });

  it('locks relationship before exercise and grant write', async () => {
    const result = await repository.grant('exercise-1', 'athlete-1', 'trainer-1');
    expect(result.status).toBe('GRANTED');
    expect(order).toEqual(['relationship', 'exercise', 'grant']);
    expect(tx.exercise.findFirst).not.toHaveBeenCalled();
  });

  it('does not lock or write an exercise when the relationship is inactive', async () => {
    tx.$queryRaw.mockImplementationOnce(async () => {
      order.push('relationship');
      return [];
    });
    tx.exercise.findFirst.mockResolvedValue({
      id: 'exercise-1',
      visibility: 'SELECTED_TRAINERS',
    });

    await expect(repository.grant('exercise-1', 'athlete-1', 'trainer-1'))
      .resolves.toEqual({ status: 'NO_ACTIVE_RELATIONSHIP' });
    expect(order).toEqual(['relationship']);
    expect(tx.exerciseTrainerAccess.upsert).not.toHaveBeenCalled();
  });

  it('preserves not-found response for an inaccessible exercise', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    tx.exercise.findFirst.mockResolvedValue(null);

    await expect(repository.grant('exercise-1', 'athlete-1', 'trainer-1'))
      .resolves.toEqual({ status: 'NOT_FOUND' });
    expect(tx.exerciseTrainerAccess.upsert).not.toHaveBeenCalled();
  });

  it('preserves private-exercise response without an active relationship', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    tx.exercise.findFirst.mockResolvedValue({
      id: 'exercise-1',
      visibility: 'PRIVATE',
    });

    await expect(repository.grant('exercise-1', 'athlete-1', 'trainer-1'))
      .resolves.toEqual({ status: 'PRIVATE' });
    expect(tx.exerciseTrainerAccess.upsert).not.toHaveBeenCalled();
  });
});
