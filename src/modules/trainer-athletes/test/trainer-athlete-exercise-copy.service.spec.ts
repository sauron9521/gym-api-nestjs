import type { Prisma } from '../../../infra/database/generated/prisma/client.js';

import { TrainerAthleteExerciseCopyService } from '../services/trainer-athlete-exercise-copy.service.js';

describe('TrainerAthleteExerciseCopyService', () => {
  const tx = {
    exercise: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  };
  const relationship = { trainerId: 'trainer-1', athleteId: 'athlete-1' };
  const activeFrom = new Date('2026-11-01T00:00:00.000Z');
  let service: TrainerAthleteExerciseCopyService;

  beforeEach(() => {
    vi.resetAllMocks();
    tx.exercise.findMany.mockResolvedValue([]);
    service = new TrainerAthleteExerciseCopyService();
  });

  const transaction = () => tx as unknown as Prisma.TransactionClient;

  it('collects only eligible trainer-created exercises linked to relationship activity', async () => {
    await service.copyRelevantExercises(
      transaction(), relationship, activeFrom, ['program-exercise-1'],
    );
    expect(tx.exercise.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: 'TRAINER_CUSTOM',
          createdById: relationship.trainerId,
          OR: expect.arrayContaining([{ id: { in: ['program-exercise-1'] } }]),
        }),
      }),
    );
    expect(tx.exercise.create).not.toHaveBeenCalled();
  });

  it('copies metadata, muscle groups and equipment as a PRIVATE athlete exercise', async () => {
    tx.exercise.findMany.mockResolvedValueOnce([{
      id: 'source-1',
      name: 'Trainer Bench',
      description: 'Chest movement',
      instructions: 'Keep elbows stable',
      exerciseType: 'STRENGTH',
      muscleGroups: [{ muscleGroupId: 'chest', role: 'PRIMARY' }],
      equipment: [{ equipmentId: 'barbell' }],
    }]).mockResolvedValueOnce([]);

    await service.copyRelevantExercises(transaction(), relationship, activeFrom, []);

    expect(tx.exercise.create).toHaveBeenCalledWith({
      data: {
        name: 'Trainer Bench',
        description: 'Chest movement',
        instructions: 'Keep elbows stable',
        exerciseType: 'STRENGTH',
        source: 'ATHLETE_CUSTOM',
        visibility: 'PRIVATE',
        isArchived: false,
        createdById: relationship.athleteId,
        copiedFromExerciseId: 'source-1',
        muscleGroups: {
          create: [{ role: 'PRIMARY', muscleGroup: { connect: { id: 'chest' } } }],
        },
        equipment: { create: [{ equipment: { connect: { id: 'barbell' } } }] },
      },
    });
  });

  it('skips exercises that have already been copied', async () => {
    const source = (id: string) => ({
      id, name: id, description: null, instructions: null,
      exerciseType: 'STRENGTH', muscleGroups: [], equipment: [],
    });
    tx.exercise.findMany.mockResolvedValueOnce([source('ex-1'), source('ex-2')])
      .mockResolvedValueOnce([{ copiedFromExerciseId: 'ex-1' }]);

    await service.copyRelevantExercises(transaction(), relationship, activeFrom, []);
    expect(tx.exercise.create).toHaveBeenCalledOnce();
    expect(tx.exercise.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ copiedFromExerciseId: 'ex-2' }) }),
    );
  });
});
