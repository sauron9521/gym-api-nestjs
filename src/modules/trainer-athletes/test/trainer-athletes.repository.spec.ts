import { PrismaService } from '../../../database/index.js';
import { Prisma } from '../../../generated/prisma/client.js';

import {
  trainerAthleteSelect,
  TrainerAthletesRepository,
} from '../trainer-athletes.repository.js';

describe('TrainerAthletesRepository', () => {
  let repository: TrainerAthletesRepository;

  const prisma = {
    $transaction: vi.fn(),

    trainerAthlete: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

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
    exercise: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    exerciseAthleteAssignment: {
      updateMany: vi.fn(),
    },
    exerciseTrainerAccess: {
      updateMany: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();

    tx.trainingProgramAssignment.findMany.mockResolvedValue([]);

    repository = new TrainerAthletesRepository(
      prisma as unknown as PrismaService,
    );
  });

  describe('findMany', () => {
    it('should return relationships with pagination metadata', async () => {
      const relationships = [
        {
          id: 'relationship-1',
          trainerId: 'trainer-1',
          athleteId: 'athlete-1',
          status: 'ACTIVE',
        },
      ];

      const where = {
        trainerId: 'trainer-1',
        status: 'ACTIVE',
      } satisfies Prisma.TrainerAthleteWhereInput;

      prisma.$transaction.mockResolvedValue([relationships, 12]);

      const result = await repository.findMany({
        where,
        skip: 10,
        take: 5,
      });

      expect(prisma.trainerAthlete.findMany).toHaveBeenCalledWith({
        where,
        skip: 10,
        take: 5,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: trainerAthleteSelect,
      });

      expect(prisma.trainerAthlete.count).toHaveBeenCalledWith({
        where,
      });

      expect(prisma.$transaction).toHaveBeenCalledOnce();

      expect(result).toEqual({
        data: relationships,
        meta: {
          total: 12,
          skip: 10,
          take: 5,
          totalPages: 3,
        },
      });
    });

    it('should use custom ordering when provided', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await repository.findMany({
        where: { athleteId: 'athlete-1' },
        skip: 0,
        take: 10,
        orderBy: [{ status: 'asc' }],
      });

      expect(prisma.trainerAthlete.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ status: 'asc' }],
        }),
      );
    });

    it('should return empty results when no relationships exist', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      const result = await repository.findMany({
        where: { trainerId: 'trainer-1' },
        skip: 0,
        take: 10,
      });

      expect(result).toEqual({
        data: [],
        meta: {
          total: 0,
          skip: 0,
          take: 10,
          totalPages: 0,
        },
      });
    });
  });

  describe('findById', () => {
    it('should return a relationship by ID with conditions', async () => {
      const relationship = {
        id: 'relationship-1',
        trainerId: 'trainer-1',
        athleteId: 'athlete-1',
        status: 'ACTIVE',
      };

      prisma.trainerAthlete.findFirst.mockResolvedValue(relationship);

      const result = await repository.findById('relationship-1', {
        trainerId: 'trainer-1',
        status: 'ACTIVE',
      });

      expect(prisma.trainerAthlete.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [
            { id: 'relationship-1' },
            {
              trainerId: 'trainer-1',
              status: 'ACTIVE',
            },
          ],
        },
        select: trainerAthleteSelect,
      });

      expect(result).toEqual(relationship);
    });

    it('should return null when relationship does not exist', async () => {
      prisma.trainerAthlete.findFirst.mockResolvedValue(null);

      const result = await repository.findById('missing-id');

      expect(result).toBeNull();
    });
  });

  describe('findOpenByPair', () => {
    it('should find a pending or active relationship', async () => {
      const relationship = {
        id: 'relationship-1',
        status: 'ACTIVE',
      };

      prisma.trainerAthlete.findFirst.mockResolvedValue(relationship);

      const result = await repository.findOpenByPair('trainer-1', 'athlete-1');

      expect(prisma.trainerAthlete.findFirst).toHaveBeenCalledWith({
        where: {
          trainerId: 'trainer-1',
          athleteId: 'athlete-1',
          status: {
            in: ['PENDING', 'ACTIVE'],
          },
        },
        select: {
          id: true,
          status: true,
        },
      });

      expect(result).toEqual(relationship);
    });

    it('should return null when no open relationship exists', async () => {
      prisma.trainerAthlete.findFirst.mockResolvedValue(null);

      const result = await repository.findOpenByPair('trainer-1', 'athlete-1');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a relationship with selected fields', async () => {
      const data = {
        trainer: {
          connect: { id: 'trainer-1' },
        },
        athlete: {
          connect: { id: 'athlete-1' },
        },
        initiatedBy: {
          connect: { id: 'trainer-1' },
        },
      };

      const relationship = {
        id: 'relationship-1',
        trainerId: 'trainer-1',
        athleteId: 'athlete-1',
        status: 'PENDING',
      };

      prisma.trainerAthlete.create.mockResolvedValue(relationship);

      const result = await repository.create(data);

      expect(prisma.trainerAthlete.create).toHaveBeenCalledWith({
        data,
        select: trainerAthleteSelect,
      });

      expect(result).toEqual(relationship);
    });

    it('should propagate database errors', async () => {
      const error = new Error('Database connection failed');

      prisma.trainerAthlete.create.mockRejectedValue(error);

      await expect(
        repository.create({
          trainer: {
            connect: { id: 'trainer-1' },
          },
          athlete: {
            connect: { id: 'athlete-1' },
          },
          initiatedBy: {
            connect: { id: 'trainer-1' },
          },
        }),
      ).rejects.toBe(error);
    });
  });

  describe('update', () => {
    it('should update relationship using conditional where', async () => {
      const where = {
        id: 'relationship-1',
        status: 'PENDING',
      } satisfies Prisma.TrainerAthleteWhereUniqueInput;

      const data = {
        status: 'ACTIVE',
        respondedAt: new Date('2026-11-01T10:00:00.000Z'),
      } satisfies Prisma.TrainerAthleteUpdateInput;

      const relationship = {
        id: 'relationship-1',
        status: 'ACTIVE',
      };

      prisma.trainerAthlete.update.mockResolvedValue(relationship);

      const result = await repository.update(where, data);

      expect(prisma.trainerAthlete.update).toHaveBeenCalledWith({
        where,
        data,
        select: trainerAthleteSelect,
      });

      expect(result).toEqual(relationship);
    });

    it('should propagate database errors', async () => {
      const error = new Error('Update failed');

      prisma.trainerAthlete.update.mockRejectedValue(error);

      await expect(
        repository.update({ id: 'relationship-1' }, { status: 'ACTIVE' }),
      ).rejects.toBe(error);
    });
  });

  describe('findActiveTrainerIdsForAthlete', () => {
    it('should return IDs of active trainers', async () => {
      prisma.trainerAthlete.findMany.mockResolvedValue([
        { trainerId: 'trainer-1' },
        { trainerId: 'trainer-2' },
      ]);

      const result =
        await repository.findActiveTrainerIdsForAthlete('athlete-1');

      expect(prisma.trainerAthlete.findMany).toHaveBeenCalledWith({
        where: {
          athleteId: 'athlete-1',
          status: 'ACTIVE',
        },
        select: {
          trainerId: true,
        },
      });

      expect(result).toEqual(['trainer-1', 'trainer-2']);
    });

    it('should return an empty array when no active trainers exist', async () => {
      prisma.trainerAthlete.findMany.mockResolvedValue([]);

      const result =
        await repository.findActiveTrainerIdsForAthlete('athlete-1');

      expect(result).toEqual([]);
    });
  });

  describe('findActiveAthleteIdsForTrainer', () => {
    it('should return IDs of active athletes', async () => {
      prisma.trainerAthlete.findMany.mockResolvedValue([
        { athleteId: 'athlete-1' },
        { athleteId: 'athlete-2' },
      ]);

      const result =
        await repository.findActiveAthleteIdsForTrainer('trainer-1');

      expect(prisma.trainerAthlete.findMany).toHaveBeenCalledWith({
        where: {
          trainerId: 'trainer-1',
          status: 'ACTIVE',
        },
        select: {
          athleteId: true,
        },
      });

      expect(result).toEqual(['athlete-1', 'athlete-2']);
    });

    it('should return an empty array when no active athletes exist', async () => {
      prisma.trainerAthlete.findMany.mockResolvedValue([]);

      const result =
        await repository.findActiveAthleteIdsForTrainer('trainer-1');

      expect(result).toEqual([]);
    });
  });

  describe('terminateWithExerciseCopies', () => {
    it('should terminate active program assignments with the relationship', async () => {
      const relationship = {
        id: 'relationship-1',
        trainerId: 'trainer-1',
        athleteId: 'athlete-1',
        createdAt: new Date('2026-10-01T10:00:00.000Z'),
        respondedAt: new Date('2026-10-01T10:00:00.000Z'),
      };

      const terminated = {
        ...relationship,
        status: 'TERMINATED',
      };

      // Transaction setup
      prisma.$transaction.mockImplementation(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );

      tx.trainerAthlete.findFirst.mockResolvedValue(relationship);
      tx.trainerAthlete.updateMany.mockResolvedValue({ count: 1 });
      tx.trainerAthlete.findUnique.mockResolvedValue(terminated);

      tx.trainingProgramAssignment.updateMany.mockResolvedValue({
        count: 2,
      });

      // No exercises to copy in this test.
      tx.trainingProgramAssignment.findMany.mockResolvedValue([
        {
          version: {
            workouts: [
              {
                exercises: [
                  { exerciseId: 'program-exercise-1' },
                  { exerciseId: 'program-exercise-2' },
                ],
              },
            ],
          },
        },
      ]);

      tx.exerciseAthleteAssignment.updateMany.mockResolvedValue({
        count: 0,
      });

      tx.exerciseTrainerAccess.updateMany.mockResolvedValue({
        count: 0,
      });

      tx.exercise.findMany.mockResolvedValue([]);

      await repository.terminateWithExerciseCopies({
        id: 'relationship-1',
        actorId: 'trainer-1',
        reason: 'Relationship ended',
      });

      expect(tx.trainingProgramAssignment.findMany).toHaveBeenCalledWith({
        where: {
          trainerAthleteId: 'relationship-1',
          status: 'ACTIVE',
        },
        select: {
          version: {
            select: {
              workouts: {
                select: {
                  exercises: {
                    select: {
                      exerciseId: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      expect(tx.exercise.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              {
                id: {
                  in: ['program-exercise-1', 'program-exercise-2'],
                },
              },
            ]),
          }),
        }),
      );

      // Verify program assignments are terminated.
      expect(tx.trainingProgramAssignment.updateMany).toHaveBeenCalledWith({
        where: {
          trainerAthleteId: 'relationship-1',
          status: 'ACTIVE',
        },
        data: {
          status: 'TERMINATED',
          endedAt: expect.any(Date),
          endedById: 'trainer-1',
          endReason: 'Relationship ended',
        },
      });

      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });
  });
});
