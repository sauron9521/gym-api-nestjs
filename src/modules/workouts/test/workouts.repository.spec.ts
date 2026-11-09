import { PrismaService } from '#src/infra/database/index';
import { Prisma } from '#prisma/client';

import { WorkoutsRepository } from '../repositories/workouts.repository.js';
import { workoutSelect } from '../selects/workout.select.js';

describe('WorkoutsRepository', () => {
  let repository: WorkoutsRepository;

  const prisma = {
    $transaction: vi.fn(),

    workout: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();

    repository = new WorkoutsRepository(prisma as unknown as PrismaService);
  });

  it('should include program references and planned set targets', () => {
    expect(workoutSelect).toMatchObject({
      programAssignmentId: true,
      programWorkoutId: true,
      exercises: {
        select: {
          sets: {
            select: {
              targetRpe: true,
              targetRir: true,
              rpe: true,
              rir: true,
            },
          },
        },
      },
    });
  });

  describe('findMany', () => {
    it('should return workouts with pagination metadata', async () => {
      const workouts = [
        { id: 'workout-1', title: 'Upper Body' },
        { id: 'workout-2', title: 'Lower Body' },
      ];

      prisma.$transaction.mockResolvedValue([workouts, 22]);

      const where = {
        athleteId: 'athlete-1',
      } satisfies Prisma.WorkoutWhereInput;

      const result = await repository.findMany({
        where,
        skip: 10,
        take: 5,
      });

      expect(prisma.workout.findMany).toHaveBeenCalledWith({
        where,
        skip: 10,
        take: 5,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: workoutSelect,
      });

      expect(prisma.workout.count).toHaveBeenCalledWith({ where });

      expect(prisma.$transaction).toHaveBeenCalledOnce();

      expect(result).toEqual({
        data: workouts,
        meta: {
          total: 22,
          skip: 10,
          take: 5,
          totalPages: 5,
        },
      });
    });

    it('should use custom ordering when provided', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await repository.findMany({
        where: {},
        skip: 0,
        take: 10,
        orderBy: [{ scheduledAt: 'asc' }],
      });

      expect(prisma.workout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ scheduledAt: 'asc' }],
        }),
      );
    });

    it('should return empty results when no workouts exist', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      const result = await repository.findMany({
        where: { athleteId: 'athlete-1' },
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
    it('should return a workout by ID with additional conditions', async () => {
      const workout = {
        id: 'workout-1',
        title: 'Upper Body',
      };

      prisma.workout.findFirst.mockResolvedValue(workout);

      const result = await repository.findById('workout-1', {
        athleteId: 'athlete-1',
        status: 'PLANNED',
      });

      expect(prisma.workout.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [
            { id: 'workout-1' },
            {
              athleteId: 'athlete-1',
              status: 'PLANNED',
            },
          ],
        },
        select: workoutSelect,
      });

      expect(result).toEqual(workout);
    });

    it('should return null when workout does not exist', async () => {
      prisma.workout.findFirst.mockResolvedValue(null);

      const result = await repository.findById('missing-id');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a workout with exercises and sets', async () => {
      const data = {
        title: 'Upper Body',
        athlete: {
          connect: { id: 'athlete-1' },
        },
        createdBy: {
          connect: { id: 'athlete-1' },
        },
        exercises: {
          create: [
            {
              exercise: {
                connect: { id: 'exercise-1' },
              },
              exerciseNameSnapshot: 'Bench Press',
              exerciseTypeSnapshot: 'STRENGTH',
              sortOrder: 0,
              sets: {
                create: [
                  {
                    setNumber: 1,
                    plannedReps: 10,
                    plannedWeightKg: '60.00',
                  },
                  {
                    setNumber: 2,
                    plannedReps: 8,
                    plannedWeightKg: '60.00',
                  },
                ],
              },
            },
          ],
        },
      } satisfies Prisma.WorkoutCreateInput;

      const workout = {
        id: 'workout-1',
        title: 'Upper Body',
        exercises: [
          {
            id: 'workout-exercise-1',
            exerciseNameSnapshot: 'Bench Press',
            sets: [
              { setNumber: 1, plannedReps: 10 },
              { setNumber: 2, plannedReps: 8 },
            ],
          },
        ],
      };

      prisma.workout.create.mockResolvedValue(workout);

      const result = await repository.create(data);

      expect(prisma.workout.create).toHaveBeenCalledWith({
        data,
        select: workoutSelect,
      });

      expect(result).toEqual(workout);
    });

    it('should propagate database errors', async () => {
      const error = new Error('Database connection failed');

      prisma.workout.create.mockRejectedValue(error);

      await expect(
        repository.create({
          title: 'Upper Body',
          athlete: {
            connect: { id: 'athlete-1' },
          },
          createdBy: {
            connect: { id: 'athlete-1' },
          },
        }),
      ).rejects.toBe(error);
    });
  });

  describe('update', () => {
    it('should update a workout using ownership conditions', async () => {
      const where = {
        id: 'workout-1',
        athleteId: 'athlete-1',
      };

      const data = {
        status: 'IN_PROGRESS',
        startedAt: new Date('2026-11-01T10:00:00.000Z'),
      } satisfies Prisma.WorkoutUpdateInput;

      const workout = {
        id: 'workout-1',
        status: 'IN_PROGRESS',
      };

      prisma.workout.update.mockResolvedValue(workout);

      const result = await repository.update(where, data);

      expect(prisma.workout.update).toHaveBeenCalledWith({
        where,
        data,
        select: workoutSelect,
      });

      expect(result).toEqual(workout);
    });

    it('should propagate database errors', async () => {
      const error = new Error('Update failed');

      prisma.workout.update.mockRejectedValue(error);

      await expect(
        repository.update({ id: 'workout-1' }, { title: 'Updated workout' }),
      ).rejects.toBe(error);
    });
  });
});
