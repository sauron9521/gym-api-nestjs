import { PrismaService } from '../../../database/index.js';

import { trainerAthleteHistoricalSelect, trainerAthleteSelect } from '../trainer-athletes.repository.js';
import { TrainerAthleteTerminationService } from '../services/trainer-athlete-termination.service.js';
import { TrainerAthleteExerciseCopyService } from '../services/trainer-athlete-exercise-copy.service.js';

describe('TrainerAthleteTerminationService', () => {
  const tx = {
    trainerAthlete: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    trainingProgramAssignment: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    exerciseAthleteAssignment: { updateMany: vi.fn() },
    exerciseTrainerAccess: { updateMany: vi.fn() },
  };

  const prisma = { $transaction: vi.fn() };
  const exerciseCopyService = { copyRelevantExercises: vi.fn() };
  let service: TrainerAthleteTerminationService;

  const relationship = {
    id: 'relationship-1',
    trainerId: 'trainer-1',
    athleteId: 'athlete-1',
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    respondedAt: new Date('2026-10-02T10:00:00.000Z'),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx),
    );
    tx.trainerAthlete.findFirst.mockResolvedValue(relationship);
    tx.trainerAthlete.updateMany.mockResolvedValue({ count: 1 });
    tx.trainerAthlete.findUnique.mockResolvedValue({
      ...relationship, status: 'TERMINATED',
    });
    tx.trainingProgramAssignment.findMany.mockResolvedValue([]);
    tx.trainingProgramAssignment.updateMany.mockResolvedValue({ count: 0 });
    tx.exerciseAthleteAssignment.updateMany.mockResolvedValue({ count: 0 });
    tx.exerciseTrainerAccess.updateMany.mockResolvedValue({ count: 0 });

    service = new TrainerAthleteTerminationService(
      prisma as unknown as PrismaService,
      exerciseCopyService as unknown as TrainerAthleteExerciseCopyService,
    );
  });

  it('terminates program assignments and revokes access in one transaction', async () => {
    tx.trainingProgramAssignment.findMany.mockResolvedValue([
      {
        version: {
          workouts: [
            { exercises: [{ exerciseId: 'exercise-1' }, { exerciseId: 'exercise-1' }] },
            { exercises: [{ exerciseId: 'exercise-2' }] },
          ],
        },
      },
    ]);

    const result = await service.terminateWithExerciseCopies({
      id: relationship.id,
      actorId: relationship.trainerId,
      reason: 'Cooperation ended',
      redactForTrainer: true,
    });

    expect(result).toMatchObject({ id: relationship.id, status: 'TERMINATED' });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(exerciseCopyService.copyRelevantExercises).toHaveBeenCalledWith(
      tx,
      relationship,
      relationship.respondedAt,
      ['exercise-1', 'exercise-2'],
    );
    expect(tx.trainingProgramAssignment.updateMany).toHaveBeenCalledWith({
      where: { trainerAthleteId: relationship.id, status: 'ACTIVE' },
      data: {
        status: 'TERMINATED',
        endedAt: expect.any(Date),
        endedById: relationship.trainerId,
        endReason: 'Cooperation ended',
      },
    });
    expect(tx.exerciseAthleteAssignment.updateMany).toHaveBeenCalledOnce();
    expect(tx.exerciseTrainerAccess.updateMany).toHaveBeenCalledOnce();
    expect(tx.trainerAthlete.findUnique).toHaveBeenCalledWith({
      where: { id: relationship.id },
      select: trainerAthleteHistoricalSelect,
    });
  });

  it('returns null without side effects when relationship is no longer active', async () => {
    tx.trainerAthlete.findFirst.mockResolvedValue(null);
    const result = await service.terminateWithExerciseCopies({
      id: relationship.id, actorId: relationship.athleteId, redactForTrainer: false,
    });
    expect(result).toBeNull();
    expect(tx.trainerAthlete.updateMany).not.toHaveBeenCalled();
    expect(exerciseCopyService.copyRelevantExercises).not.toHaveBeenCalled();
  });

  it('does not copy exercises or revoke access when the transition was lost', async () => {
    tx.trainerAthlete.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.terminateWithExerciseCopies({
      id: relationship.id, actorId: relationship.athleteId, redactForTrainer: false,
    })).toBeNull();
    expect(tx.trainingProgramAssignment.updateMany).not.toHaveBeenCalled();
    expect(exerciseCopyService.copyRelevantExercises).not.toHaveBeenCalled();
  });

  it('propagates exercise-copy failures so the surrounding transaction rolls back', async () => {
    const dbError = new Error('Exercise copy failed');
    exerciseCopyService.copyRelevantExercises.mockRejectedValue(dbError);
    await expect(service.terminateWithExerciseCopies({
      id: relationship.id, actorId: relationship.athleteId, redactForTrainer: false,
    })).rejects.toBe(dbError);
    expect(tx.exerciseTrainerAccess.updateMany).not.toHaveBeenCalled();
  });

  it('uses full response only for an athlete and falls back to relationship creation date', async () => {
    tx.trainerAthlete.findFirst.mockResolvedValue({ ...relationship, respondedAt: null });
    await service.terminateWithExerciseCopies({
      id: relationship.id, actorId: relationship.athleteId, redactForTrainer: false,
    });
    expect(exerciseCopyService.copyRelevantExercises).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: relationship.id }),
      relationship.createdAt,
      [],
    );
    expect(tx.trainerAthlete.findUnique).toHaveBeenCalledWith({
      where: { id: relationship.id },
      select: trainerAthleteSelect,
    });
  });
});
