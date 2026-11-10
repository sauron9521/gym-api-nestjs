import { PrismaService } from '#src/infra/database/index';
import { Prisma } from '#prisma/client';

import { WorkoutsRepository } from '../repositories/workouts.repository.js';
import { WorkoutCreationRepository } from '../repositories/workout-creation.repository.js';
import { workoutSelect, workoutSummarySelect } from '../selects/workout.select.js';

describe('WorkoutsRepository', () => {
  let repository: WorkoutsRepository;

  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    exercise: { findMany: vi.fn() },
    trainingProgramAssignment: { findFirst: vi.fn(), update: vi.fn() },

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

    repository = new WorkoutsRepository(prisma as unknown as PrismaService, new WorkoutCreationRepository(prisma as unknown as PrismaService));
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

  describe('findManySummary', () => {
    it('fetches only compact scalar fields and exercise count', async () => {
      prisma.$transaction.mockResolvedValue([
        [
          {
            id: 'workout-1',
            title: 'Upper Body',
            status: 'COMPLETED',
            _count: { exercises: 3 },
          },
        ],
        12,
      ]);
      const where = { athleteId: 'athlete-1' };

      const result = await repository.findManySummary({
        where,
        skip: 5,
        take: 5,
      });

      expect(workoutSummarySelect).not.toHaveProperty('exercises');
      expect(workoutSummarySelect).not.toHaveProperty('notes');
      expect(prisma.workout.findMany).toHaveBeenCalledWith({
        where,
        skip: 5,
        take: 5,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: workoutSummarySelect,
      });
      expect(prisma.workout.count).toHaveBeenCalledWith({ where });
      expect(result).toEqual({
        data: [
          {
            id: 'workout-1',
            title: 'Upper Body',
            status: 'COMPLETED',
            exerciseCount: 3,
          },
        ],
        meta: { total: 12, skip: 5, take: 5, totalPages: 3 },
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
    beforeEach(() => {
      prisma.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      prisma.$queryRaw.mockResolvedValue([
        { id: 'exercise-1', source: 'GLOBAL', createdById: null, isArchived: false },
      ]);
      prisma.exercise.findMany.mockResolvedValue([
        { id: 'exercise-1', name: 'Bench Press', exerciseType: 'STRENGTH' },
      ]);
    });
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

      const result = await repository.create(data, 'athlete-1', ['exercise-1']);

      expect(prisma.workout.create).toHaveBeenCalledWith({
        data,
        select: workoutSelect,
      });

      expect(result).toEqual(workout);
    });

    it('locks exercises before active trainer relationships and the workout insert', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: 'exercise-1', source: 'TRAINER_CUSTOM', createdById: 'trainer-1', isArchived: false },
        ])
        .mockResolvedValueOnce([{ id: 'relationship-1', trainerId: 'trainer-1' }]);
      prisma.exercise.findMany.mockResolvedValue([
        { id: 'exercise-1', name: 'Trainer Bench', exerciseType: 'STRENGTH' },
      ]);
      prisma.workout.create.mockResolvedValue({ id: 'created-workout' });
      await expect(repository.create({
        title: 'Trainer Workout',
        athlete: { connect: { id: 'athlete-1' } },
        createdBy: { connect: { id: 'athlete-1' } },
      }, 'athlete-1', ['exercise-1'])).resolves.toMatchObject({ id: 'created-workout' });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(prisma.exercise.findMany).toHaveBeenCalledOnce();
      expect(prisma.workout.create).toHaveBeenCalledOnce();
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$queryRaw.mock.invocationCallOrder[1]!,
      );
      expect(prisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
        prisma.workout.create.mock.invocationCallOrder[0]!,
      );
    });

    it('rejects a trainer exercise when collaboration ended after exercise locking', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { id: 'exercise-1', source: 'TRAINER_CUSTOM', createdById: 'trainer-1', isArchived: false },
        ])
        .mockResolvedValueOnce([]);
      prisma.exercise.findMany.mockResolvedValue([]);
      await expect(repository.create({
        title: 'Forbidden Workout',
        athlete: { connect: { id: 'athlete-1' } },
        createdBy: { connect: { id: 'athlete-1' } },
      }, 'athlete-1', ['exercise-1'])).rejects.toThrow('One or more exercises are not available');
      expect(prisma.workout.create).not.toHaveBeenCalled();
    });

    it.each(['GLOBAL', 'ATHLETE_CUSTOM', 'TRAINER_CUSTOM'] as const)(
      'rejects archived %s references under the row lock, before creating a workout',
      async (source) => {
        prisma.$queryRaw.mockResolvedValueOnce([
          { id: 'exercise-1', source, createdById: source === 'GLOBAL' ? null : 'user-1', isArchived: true },
        ]);
        await expect(repository.create({
          title: 'Archived reference',
          athlete: { connect: { id: 'athlete-1' } },
          createdBy: { connect: { id: 'athlete-1' } },
        }, 'athlete-1', ['exercise-1'])).rejects.toThrow(
          'One or more exercises are not available',
        );
        expect(prisma.$queryRaw).toHaveBeenCalledOnce();
        expect(prisma.exercise.findMany).not.toHaveBeenCalled();
        expect(prisma.workout.create).not.toHaveBeenCalled();
      },
    );

    it('rejects unavailable exercise IDs after the lock query without inserting', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);
      await expect(repository.create({
        title: 'Unknown exercise',
        athlete: { connect: { id: 'athlete-1' } },
        createdBy: { connect: { id: 'athlete-1' } },
      }, 'athlete-1', ['exercise-1'])).rejects.toThrow(
        'One or more exercises are not available',
      );
      expect(prisma.exercise.findMany).not.toHaveBeenCalled();
      expect(prisma.workout.create).not.toHaveBeenCalled();
    });

    it('locks unique source IDs once even if repeated in the workout', async () => {
      prisma.workout.create.mockResolvedValue({ id: 'workout-1' });
      await repository.create({
        title: 'Repeated reference',
        athlete: { connect: { id: 'athlete-1' } },
        createdBy: { connect: { id: 'athlete-1' } },
      }, 'athlete-1', ['exercise-1', 'exercise-1']);
      expect(prisma.$queryRaw).toHaveBeenCalledOnce();
      expect(prisma.exercise.findMany).toHaveBeenCalledOnce();
      expect(prisma.workout.create).toHaveBeenCalledOnce();
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
        }, 'athlete-1', ['exercise-1']),
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


  describe('startWorkout security', () => {
    const globalExercise = {
      id: 'exercise-1',
      source: 'GLOBAL',
      createdById: null,
      isArchived: false,
    };
    const trainerExercise = {
      id: 'exercise-2',
      source: 'TRAINER_CUSTOM',
      createdById: 'trainer-1',
      isArchived: false,
    };

    beforeEach(() => {
      prisma.$transaction.mockImplementation(
        async (callback: (tx: typeof prisma) => Promise<unknown>) =>
          callback(prisma),
      );
      prisma.workout.findFirst.mockResolvedValue({
        id: 'workout-1',
        programAssignmentId: null,
      });
      prisma.workout.update.mockResolvedValue({
        id: 'workout-1',
        status: 'IN_PROGRESS',
      });
      prisma.$queryRaw.mockResolvedValue([globalExercise]);
    });

    it('locks even global exercise references before allowing a start', async () => {
      const result = await repository.startWorkout({
        id: 'workout-1',
        athleteId: 'athlete-1',
        startedAt: new Date('2030-01-01T10:00:00Z'),
      });
      expect(result).toMatchObject({ status: 'IN_PROGRESS' });
      expect(prisma.$queryRaw).toHaveBeenCalledOnce();
      expect(prisma.workout.update).toHaveBeenCalledOnce();
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.workout.update.mock.invocationCallOrder[0]!,
      );
      expect(prisma.exercise.findMany).not.toHaveBeenCalled();
    });

    it('checks trainer exercise owners under ACTIVE relationship lock before starting', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([trainerExercise, trainerExercise])
        .mockResolvedValueOnce([
          { id: 'relationship-1', trainerId: 'trainer-1' },
        ]);
      const result = await repository.startWorkout({
        id: 'workout-1',
        athleteId: 'athlete-1',
        startedAt: new Date('2030-01-01T10:00:00Z'),
      });
      expect(result).toMatchObject({ status: 'IN_PROGRESS' });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(prisma.workout.update).toHaveBeenCalledOnce();
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$queryRaw.mock.invocationCallOrder[1]!,
      );
    });

    it.each(['GLOBAL', 'ATHLETE_CUSTOM', 'TRAINER_CUSTOM'] as const)(
      'rejects an archived %s exercise before changing the workout or assignment',
      async (source) => {
        prisma.$queryRaw.mockResolvedValueOnce([
          { ...globalExercise, source, isArchived: true },
        ]);
        await expect(repository.startWorkout({
          id: 'workout-1',
          athleteId: 'athlete-1',
          startedAt: new Date('2030-01-01T10:00:00Z'),
        })).resolves.toBeNull();
        expect(prisma.$queryRaw).toHaveBeenCalledOnce();
        expect(prisma.trainingProgramAssignment.update).not.toHaveBeenCalled();
        expect(prisma.workout.update).not.toHaveBeenCalled();
      },
    );

    it('rejects archived exercises in a program without mutating the assignment timestamp', async () => {
      prisma.workout.findFirst.mockResolvedValue({
        id: 'workout-1',
        programAssignmentId: 'assignment-1',
      });
      prisma.$queryRaw.mockResolvedValueOnce([
        { ...globalExercise, isArchived: true },
      ]);
      await expect(repository.startWorkout({
        id: 'workout-1',
        athleteId: 'athlete-1',
        startedAt: new Date('2030-01-01T10:00:00Z'),
      })).resolves.toBeNull();
      expect(prisma.trainingProgramAssignment.findFirst).not.toHaveBeenCalled();
      expect(prisma.trainingProgramAssignment.update).not.toHaveBeenCalled();
      expect(prisma.workout.update).not.toHaveBeenCalled();
    });

    it('rejects a planned workout with a revoked trainer relationship without mutation', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([trainerExercise])
        .mockResolvedValueOnce([]);
      await expect(repository.startWorkout({
        id: 'workout-1',
        athleteId: 'athlete-1',
        startedAt: new Date('2030-01-01T10:00:00Z'),
      })).resolves.toBeNull();
      expect(prisma.workout.update).not.toHaveBeenCalled();
    });

    it('rejects program start if the original assignment relationship is no longer ACTIVE', async () => {
      prisma.workout.findFirst.mockResolvedValue({
        id: 'workout-1',
        programAssignmentId: 'assignment-1',
      });
      prisma.trainingProgramAssignment.findFirst.mockResolvedValue({
        trainerAthleteId: 'old-relationship',
        trainerAthlete: { trainerId: 'trainer-1' },
      });
      prisma.$queryRaw
        .mockResolvedValueOnce([globalExercise])
        .mockResolvedValueOnce([
          { id: 'new-relationship', trainerId: 'trainer-1' },
        ]);
      await expect(repository.startWorkout({
        id: 'workout-1',
        athleteId: 'athlete-1',
        startedAt: new Date('2030-01-01T10:00:00Z'),
      })).resolves.toBeNull();
      expect(prisma.trainingProgramAssignment.update).not.toHaveBeenCalled();
      expect(prisma.workout.update).not.toHaveBeenCalled();
    });

    it('locks assignment after exercise and relationship, setting first startedAt once', async () => {
      prisma.workout.findFirst.mockResolvedValue({
        id: 'workout-1',
        programAssignmentId: 'assignment-1',
      });
      prisma.trainingProgramAssignment.findFirst.mockResolvedValue({
        trainerAthleteId: 'relationship-1',
        trainerAthlete: { trainerId: 'trainer-1' },
      });
      prisma.$queryRaw
        .mockResolvedValueOnce([globalExercise])
        .mockResolvedValueOnce([
          { id: 'relationship-1', trainerId: 'trainer-1' },
        ])
        .mockResolvedValueOnce([
          { id: 'assignment-1', status: 'ACTIVE', startedAt: null },
        ]);
      prisma.trainingProgramAssignment.update.mockResolvedValue({});
      const result = await repository.startWorkout({
        id: 'workout-1',
        athleteId: 'athlete-1',
        startedAt: new Date('2030-01-01T10:00:00Z'),
      });
      expect(result).toMatchObject({ status: 'IN_PROGRESS' });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
      expect(prisma.trainingProgramAssignment.update).toHaveBeenCalledOnce();
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$queryRaw.mock.invocationCallOrder[1]!,
      );
      expect(prisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
        prisma.$queryRaw.mock.invocationCallOrder[2]!,
      );
      expect(prisma.workout.update).toHaveBeenCalledOnce();
    });

    it('does not lock exercises or modify an already in-progress workout', async () => {
      prisma.workout.findFirst.mockResolvedValue(null);
      await expect(repository.startWorkout({
        id: 'workout-1',
        athleteId: 'athlete-1',
        startedAt: new Date('2030-01-01T10:00:00Z'),
      })).resolves.toBeNull();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.workout.update).not.toHaveBeenCalled();
    });
  });
});
