import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../utility/test-db-helper.js';

import { TrainingProgramsModule } from '../../src/modules/training-programs/training-programs.module.js';
import { PrismaModule, PrismaService } from '../../src/database/index.js';
import { WorkoutsModule } from '../../src/modules/workouts/workouts.module.js';
import { WorkoutsRepository } from '../../src/modules/workouts/workouts.repository.js';
import { TrainingProgramsRepository } from '../../src/modules/training-programs/training-programs.repository.js';

describe('WorkoutsRepository.createFromProgram integration (e2e)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  let repository: WorkoutsRepository;
  let trainingProgramsRepository: TrainingProgramsRepository;

  const cleanup = {
    userIds: [] as string[],
    exerciseIds: [] as string[],
    trainerAthleteIds: [] as string[],
    programIds: [] as string[],
    assignmentIds: [] as string[],
  };

  async function createFixture() {
    const suffix = randomUUID();

    const trainer = await prisma.user.create({
      data: {
        email: `workout-program-trainer-${suffix}@example.com`,
        passwordHash: 'test-password-hash',
        role: 'TRAINER',
      },
      select: { id: true },
    });

    cleanup.userIds.push(trainer.id);

    const athlete = await prisma.user.create({
      data: {
        email: `workout-program-athlete-${suffix}@example.com`,
        passwordHash: 'test-password-hash',
        role: 'ATHLETE',
      },
      select: { id: true },
    });

    cleanup.userIds.push(athlete.id);

    const trainerAthlete = await prisma.trainerAthlete.create({
      data: {
        trainerId: trainer.id,
        athleteId: athlete.id,
        initiatedById: trainer.id,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    cleanup.trainerAthleteIds.push(trainerAthlete.id);

    const program = await prisma.trainingProgram.create({
      data: {
        trainerId: trainer.id,
        status: 'PUBLISHED',
      },
      select: { id: true },
    });

    cleanup.programIds.push(program.id);

    const version = await prisma.trainingProgramVersion.create({
      data: {
        programId: program.id,
        version: 1,
        title: 'Integration Test Program',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
      select: { id: true },
    });

    // A second version is used to verify that a workout
    // from a different version cannot be assigned.
    const anotherVersion = await prisma.trainingProgramVersion.create({
      data: {
        programId: program.id,
        version: 2,
        title: 'Another Program Version',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
      select: { id: true },
    });

    const exercise = await prisma.exercise.create({
      data: {
        name: 'Integration Test Bench Press',
        source: 'GLOBAL',
        exerciseType: 'STRENGTH',
      },
      select: { id: true },
    });

    cleanup.exerciseIds.push(exercise.id);

    const programWorkout = await prisma.trainingProgramWorkout.create({
      data: {
        versionId: version.id,
        weekNumber: 1,
        dayNumber: 1,
        title: 'Upper Body',
        notes: 'Integration test workout',
      },
      select: { id: true },
    });

    const anotherProgramWorkout = await prisma.trainingProgramWorkout.create({
      data: {
        versionId: anotherVersion.id,
        weekNumber: 1,
        dayNumber: 1,
        title: 'Another Upper Body',
      },
      select: { id: true },
    });

    const programExercise = await prisma.trainingProgramExercise.create({
      data: {
        workoutId: programWorkout.id,
        exerciseId: exercise.id,
        exerciseNameSnapshot: 'Bench Press Snapshot',
        exerciseTypeSnapshot: 'STRENGTH',
        sortOrder: 0,
        notes: 'Exercise notes',
      },
      select: { id: true },
    });

    await prisma.trainingProgramSet.create({
      data: {
        programExerciseId: programExercise.id,
        setNumber: 1,
        setType: 'WORKING',
        plannedReps: 10,
        plannedWeightKg: 60,
        restSeconds: 90,
        targetRpe: 8,
        targetRir: 2,
        notes: 'Set notes',
      },
    });

    const assignment = await prisma.trainingProgramAssignment.create({
      data: {
        versionId: version.id,
        trainerAthleteId: trainerAthlete.id,
        athleteId: athlete.id,
        assignedById: trainer.id,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    cleanup.assignmentIds.push(assignment.id);

    return {
      athleteId: athlete.id,
      assignmentId: assignment.id,
      programWorkoutId: programWorkout.id,
      anotherProgramWorkoutId: anotherProgramWorkout.id,
      exerciseId: exercise.id,
    };
  }

  beforeAll(async () => {
    useTestDatabase();

    const moduleRef = await Test.createTestingModule({
      imports: [
        await ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        WorkoutsModule,
        TrainingProgramsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    await app.init();

    prisma = app.get(PrismaService);
    repository = app.get(WorkoutsRepository);
    trainingProgramsRepository = app.get(TrainingProgramsRepository);
  }, 20_000);

  afterAll(async () => {
    try {
      if (!prisma) return;

      if (cleanup.assignmentIds.length > 0) {
        await prisma.workout.deleteMany({
          where: {
            programAssignmentId: {
              in: cleanup.assignmentIds,
            },
          },
        });

        await prisma.trainingProgramAssignment.deleteMany({
          where: {
            id: { in: cleanup.assignmentIds },
          },
        });
      }

      if (cleanup.programIds.length > 0) {
        await prisma.trainingProgramVersion.deleteMany({
          where: {
            programId: { in: cleanup.programIds },
          },
        });

        await prisma.trainingProgram.deleteMany({
          where: {
            id: { in: cleanup.programIds },
          },
        });
      }

      if (cleanup.trainerAthleteIds.length > 0) {
        await prisma.trainerAthlete.deleteMany({
          where: {
            id: { in: cleanup.trainerAthleteIds },
          },
        });
      }

      if (cleanup.exerciseIds.length > 0) {
        await prisma.exercise.deleteMany({
          where: {
            id: { in: cleanup.exerciseIds },
          },
        });
      }

      if (cleanup.userIds.length > 0) {
        await prisma.user.deleteMany({
          where: {
            id: { in: cleanup.userIds },
          },
        });
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('creates a workout with exercises and planned sets from an active program', async () => {
    const fixture = await createFixture();

    const scheduledAt = new Date('2030-01-15T10:00:00.000Z');

    const result = await repository.createFromProgram({
      athleteId: fixture.athleteId,
      assignmentId: fixture.assignmentId,
      programWorkoutId: fixture.programWorkoutId,
      scheduledAt,
    });

    expect(result).not.toBeNull();

    expect(result).toMatchObject({
      title: 'Upper Body',
      notes: 'Integration test workout',
      athleteId: fixture.athleteId,
      createdById: fixture.athleteId,
      status: 'PLANNED',
      scheduledAt,
      programAssignmentId: fixture.assignmentId,
      programWorkoutId: fixture.programWorkoutId,
      exercises: [
        {
          exerciseId: fixture.exerciseId,
          exerciseNameSnapshot: 'Bench Press Snapshot',
          exerciseTypeSnapshot: 'STRENGTH',
          sortOrder: 0,
          notes: 'Exercise notes',
          sets: [
            {
              setNumber: 1,
              setType: 'WORKING',
              status: 'PENDING',
              plannedReps: 10,
              restSeconds: 90,
              targetRir: 2,
              actualReps: null,
              completedAt: null,
            },
          ],
        },
      ],
    });

    expect(result!.exercises[0]!.sets[0]!.plannedWeightKg!.toString()).toBe(
      '60',
    );

    expect(result!.exercises[0]!.sets[0]!.targetRpe!.toString()).toBe('8');
  });

  it('returns null when the assignment is not active', async () => {
    const fixture = await createFixture();

    await prisma.trainingProgramAssignment.update({
      where: { id: fixture.assignmentId },
      data: { status: 'CANCELLED' },
    });

    const result = await repository.createFromProgram({
      athleteId: fixture.athleteId,
      assignmentId: fixture.assignmentId,
      programWorkoutId: fixture.programWorkoutId,
    });

    expect(result).toBeNull();

    await expect(
      prisma.workout.count({
        where: { programAssignmentId: fixture.assignmentId },
      }),
    ).resolves.toBe(0);
  });

  it('returns null when the workout belongs to another program version', async () => {
    const fixture = await createFixture();

    const result = await repository.createFromProgram({
      athleteId: fixture.athleteId,
      assignmentId: fixture.assignmentId,
      programWorkoutId: fixture.anotherProgramWorkoutId,
    });

    expect(result).toBeNull();

    await expect(
      prisma.workout.count({
        where: { programAssignmentId: fixture.assignmentId },
      }),
    ).resolves.toBe(0);
  });

  it('should set assignment startedAt only on the first workout start', async () => {
    const fixture = await createFixture();

    const firstWorkout = await repository.createFromProgram({
      athleteId: fixture.athleteId,
      assignmentId: fixture.assignmentId,
      programWorkoutId: fixture.programWorkoutId,
    });

    expect(firstWorkout).not.toBeNull();

    const firstStartedAt = new Date('2030-01-15T10:00:00.000Z');

    const firstResult = await repository.startWorkout({
      id: firstWorkout!.id,
      athleteId: fixture.athleteId,
      startedAt: firstStartedAt,
    });

    expect(firstResult).toMatchObject({
      id: firstWorkout!.id,
      status: 'IN_PROGRESS',
      startedAt: firstStartedAt,
    });

    const assignmentAfterFirstStart =
      await prisma.trainingProgramAssignment.findUnique({
        where: { id: fixture.assignmentId },
        select: { startedAt: true },
      });

    expect(assignmentAfterFirstStart?.startedAt).toEqual(firstStartedAt);

    // Create another workout from the same assignment.
    const secondWorkout = await repository.createFromProgram({
      athleteId: fixture.athleteId,
      assignmentId: fixture.assignmentId,
      programWorkoutId: fixture.programWorkoutId,
    });

    expect(secondWorkout).not.toBeNull();

    const secondStartedAt = new Date('2030-01-16T10:00:00.000Z');

    const secondResult = await repository.startWorkout({
      id: secondWorkout!.id,
      athleteId: fixture.athleteId,
      startedAt: secondStartedAt,
    });

    expect(secondResult).toMatchObject({
      id: secondWorkout!.id,
      status: 'IN_PROGRESS',
      startedAt: secondStartedAt,
    });

    const assignmentAfterSecondStart =
      await prisma.trainingProgramAssignment.findUnique({
        where: { id: fixture.assignmentId },
        select: { startedAt: true },
      });

    // Assignment keeps the timestamp of its first workout.
    expect(assignmentAfterSecondStart?.startedAt).toEqual(firstStartedAt);
  });

  it('should not start a workout when its assignment is inactive', async () => {
    const fixture = await createFixture();

    const workout = await repository.createFromProgram({
      athleteId: fixture.athleteId,
      assignmentId: fixture.assignmentId,
      programWorkoutId: fixture.programWorkoutId,
    });

    expect(workout).not.toBeNull();

    await prisma.trainingProgramAssignment.update({
      where: { id: fixture.assignmentId },
      data: { status: 'CANCELLED' },
    });

    const result = await repository.startWorkout({
      id: workout!.id,
      athleteId: fixture.athleteId,
      startedAt: new Date('2030-01-15T10:00:00.000Z'),
    });

    expect(result).toBeNull();

    const persistedWorkout = await prisma.workout.findUnique({
      where: { id: workout!.id },
      select: {
        status: true,
        startedAt: true,
      },
    });

    expect(persistedWorkout).toMatchObject({
      status: 'PLANNED',
      startedAt: null,
    });

    const assignment = await prisma.trainingProgramAssignment.findUnique({
      where: { id: fixture.assignmentId },
      select: { startedAt: true },
    });

    expect(assignment?.startedAt).toBeNull();
  });

  it('should complete an assignment when all workouts are completed', async () => {
    const fixture = await createFixture();

    const workout = await repository.createFromProgram({
      athleteId: fixture.athleteId,
      assignmentId: fixture.assignmentId,
      programWorkoutId: fixture.programWorkoutId,
    });

    expect(workout).not.toBeNull();

    await prisma.workout.update({
      where: { id: workout!.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date('2030-01-15T11:00:00.000Z'),
      },
    });

    const completedAt = new Date('2030-01-15T12:00:00.000Z');

    const result =
      await trainingProgramsRepository.completeAssignmentIfNoUnfinishedWorkouts(
        {
          assignmentId: fixture.assignmentId,
          athleteId: fixture.athleteId,
          completedAt,
        },
      );

    expect(result.status).toBe('COMPLETED');

    if (result.status !== 'COMPLETED') {
      throw new Error('Expected assignment to be completed');
    }

    expect(result.assignment).toMatchObject({
      id: fixture.assignmentId,
      status: 'COMPLETED',
      completedAt,
    });

    const persistedAssignment =
      await prisma.trainingProgramAssignment.findUnique({
        where: { id: fixture.assignmentId },
        select: {
          status: true,
          completedAt: true,
        },
      });

    expect(persistedAssignment).toEqual({
      status: 'COMPLETED',
      completedAt,
    });
  });

  it('should not complete an assignment when a planned workout exists', async () => {
    const fixture = await createFixture();

    const workout = await repository.createFromProgram({
      athleteId: fixture.athleteId,
      assignmentId: fixture.assignmentId,
      programWorkoutId: fixture.programWorkoutId,
    });

    expect(workout).not.toBeNull();

    const result =
      await trainingProgramsRepository.completeAssignmentIfNoUnfinishedWorkouts(
        {
          assignmentId: fixture.assignmentId,
          athleteId: fixture.athleteId,
          completedAt: new Date('2030-01-15T12:00:00.000Z'),
        },
      );

    expect(result).toEqual({
      status: 'HAS_UNFINISHED_WORKOUTS',
      unfinishedCount: 1,
    });

    const assignment = await prisma.trainingProgramAssignment.findUnique({
      where: { id: fixture.assignmentId },
      select: {
        status: true,
        completedAt: true,
      },
    });

    expect(assignment).toEqual({
      status: 'ACTIVE',
      completedAt: null,
    });
  });

  it('should not complete an assignment when an in-progress workout exists', async () => {
    const fixture = await createFixture();

    const workout = await repository.createFromProgram({
      athleteId: fixture.athleteId,
      assignmentId: fixture.assignmentId,
      programWorkoutId: fixture.programWorkoutId,
    });

    expect(workout).not.toBeNull();

    await prisma.workout.update({
      where: { id: workout!.id },
      data: {
        status: 'IN_PROGRESS',
        startedAt: new Date('2030-01-15T10:00:00.000Z'),
      },
    });

    const result =
      await trainingProgramsRepository.completeAssignmentIfNoUnfinishedWorkouts(
        {
          assignmentId: fixture.assignmentId,
          athleteId: fixture.athleteId,
          completedAt: new Date('2030-01-15T12:00:00.000Z'),
        },
      );

    expect(result).toEqual({
      status: 'HAS_UNFINISHED_WORKOUTS',
      unfinishedCount: 1,
    });

    const assignment = await prisma.trainingProgramAssignment.findUnique({
      where: { id: fixture.assignmentId },
      select: {
        status: true,
        completedAt: true,
      },
    });

    expect(assignment).toEqual({
      status: 'ACTIVE',
      completedAt: null,
    });
  });

  it('should not complete an inactive assignment', async () => {
    const fixture = await createFixture();

    await prisma.trainingProgramAssignment.update({
      where: { id: fixture.assignmentId },
      data: {
        status: 'CANCELLED',
      },
    });

    const result =
      await trainingProgramsRepository.completeAssignmentIfNoUnfinishedWorkouts(
        {
          assignmentId: fixture.assignmentId,
          athleteId: fixture.athleteId,
          completedAt: new Date('2030-01-15T12:00:00.000Z'),
        },
      );

    expect(result).toEqual({
      status: 'NOT_ACTIVE',
    });

    const assignment = await prisma.trainingProgramAssignment.findUnique({
      where: { id: fixture.assignmentId },
      select: {
        status: true,
        completedAt: true,
      },
    });

    expect(assignment).toEqual({
      status: 'CANCELLED',
      completedAt: null,
    });
  });

  it('should keep assignment and workouts consistent during concurrent creation and completion', async () => {
    const fixture = await createFixture();

    const [createdWorkout, completionResult] = await Promise.all([
      repository.createFromProgram({
        athleteId: fixture.athleteId,
        assignmentId: fixture.assignmentId,
        programWorkoutId: fixture.programWorkoutId,
      }),

      trainingProgramsRepository.completeAssignmentIfNoUnfinishedWorkouts({
        assignmentId: fixture.assignmentId,
        athleteId: fixture.athleteId,
        completedAt: new Date(),
      }),
    ]);

    const assignment = await prisma.trainingProgramAssignment.findUniqueOrThrow(
      {
        where: { id: fixture.assignmentId },
        select: {
          status: true,
          completedAt: true,
        },
      },
    );

    const workoutCount = await prisma.workout.count({
      where: {
        programAssignmentId: fixture.assignmentId,
      },
    });

    if (completionResult.status === 'COMPLETED') {
      // Completion won the race.
      expect(createdWorkout).toBeNull();
      expect(assignment.status).toBe('COMPLETED');
      expect(assignment.completedAt).not.toBeNull();
      expect(workoutCount).toBe(0);
    } else {
      // Creation won the race.
      expect(completionResult).toEqual({
        status: 'HAS_UNFINISHED_WORKOUTS',
        unfinishedCount: 1,
      });

      expect(createdWorkout).not.toBeNull();
      expect(assignment.status).toBe('ACTIVE');
      expect(assignment.completedAt).toBeNull();
      expect(workoutCount).toBe(1);
    }
  });

  it('should complete an assignment only once under concurrent requests', async () => {
    const fixture = await createFixture();

    const firstCompletedAt = new Date('2030-01-15T12:00:00.000Z');
    const secondCompletedAt = new Date('2030-01-16T12:00:00.000Z');

    const results = await Promise.all([
      trainingProgramsRepository.completeAssignmentIfNoUnfinishedWorkouts({
        assignmentId: fixture.assignmentId,
        athleteId: fixture.athleteId,
        completedAt: firstCompletedAt,
      }),

      trainingProgramsRepository.completeAssignmentIfNoUnfinishedWorkouts({
        assignmentId: fixture.assignmentId,
        athleteId: fixture.athleteId,
        completedAt: secondCompletedAt,
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'COMPLETED',
      'NOT_ACTIVE',
    ]);

    const completedResult = results.find(
      (result) => result.status === 'COMPLETED',
    );

    if (!completedResult || completedResult.status !== 'COMPLETED') {
      throw new Error('Expected exactly one successful completion');
    }

    const persistedAssignment =
      await prisma.trainingProgramAssignment.findUniqueOrThrow({
        where: { id: fixture.assignmentId },
        select: {
          status: true,
          completedAt: true,
        },
      });

    expect(persistedAssignment).toEqual({
      status: 'COMPLETED',
      completedAt: completedResult.assignment.completedAt,
    });
  });

  it('should wait for assignment lock and reject workout creation after completion', async () => {
    const fixture = await createFixture();

    let creationPromise:
      ReturnType<WorkoutsRepository['createFromProgram']> | undefined;

    let observedBlocking = false;

    // Transaction A locks the assignment row.
    await prisma.$transaction(
      async (tx) => {
        const [lockedRow] = await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid()::integer AS pid
        FROM "training_program_assignments"
        WHERE "id" = ${fixture.assignmentId}
        FOR UPDATE
      `;

        expect(lockedRow).toBeDefined();

        // Transaction B attempts to create a workout.
        creationPromise = repository.createFromProgram({
          athleteId: fixture.athleteId,
          assignmentId: fixture.assignmentId,
          programWorkoutId: fixture.programWorkoutId,
        });

        // Wait until PostgreSQL reports that B is blocked by A.
        for (let attempt = 0; attempt < 60; attempt++) {
          const [state] = await prisma.$queryRaw<
            Array<{ is_blocked: boolean }>
          >`
          SELECT EXISTS (
            SELECT 1
            FROM pg_stat_activity AS activity
            WHERE activity.datname = current_database()
              AND ${lockedRow!.pid} = ANY(
                pg_blocking_pids(activity.pid)
              )
          ) AS is_blocked
        `;

          if (state?.is_blocked) {
            observedBlocking = true;
            break;
          }

          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        }

        // Transaction A completes the assignment before releasing its lock.
        await tx.trainingProgramAssignment.update({
          where: { id: fixture.assignmentId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
          },
        });
      },
      { timeout: 15_000 },
    );

    // After A commits, transaction B can continue.
    const createdWorkout = await creationPromise;

    expect(observedBlocking).toBe(true);
    expect(createdWorkout).toBeNull();

    const assignment = await prisma.trainingProgramAssignment.findUniqueOrThrow(
      {
        where: { id: fixture.assignmentId },
        select: { status: true },
      },
    );

    expect(assignment.status).toBe('COMPLETED');

    const workoutCount = await prisma.workout.count({
      where: {
        programAssignmentId: fixture.assignmentId,
      },
    });

    expect(workoutCount).toBe(0);
  }, 20_000);

  it('should reject assignment completion when a concurrent transaction creates a workout', async () => {
    const fixture = await createFixture();

    let completionPromise:
      | ReturnType<
          TrainingProgramsRepository['completeAssignmentIfNoUnfinishedWorkouts']
        >
      | undefined;

    let observedBlocking = false;

    // Transaction A locks the assignment and creates a workout.
    await prisma.$transaction(
      async (tx) => {
        const [lockedRow] = await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid()::integer AS pid
        FROM "training_program_assignments"
        WHERE "id" = ${fixture.assignmentId}
        FOR UPDATE
      `;

        expect(lockedRow).toBeDefined();

        await tx.workout.create({
          data: {
            title: 'Concurrent Workout',
            athleteId: fixture.athleteId,
            createdById: fixture.athleteId,
            programAssignmentId: fixture.assignmentId,
            programWorkoutId: fixture.programWorkoutId,
            status: 'PLANNED',
          },
        });

        // Transaction B attempts to complete the assignment.
        completionPromise =
          trainingProgramsRepository.completeAssignmentIfNoUnfinishedWorkouts({
            assignmentId: fixture.assignmentId,
            athleteId: fixture.athleteId,
            completedAt: new Date(),
          });

        // Verify B is waiting for A.
        for (let attempt = 0; attempt < 60; attempt++) {
          const [state] = await prisma.$queryRaw<
            Array<{ is_blocked: boolean }>
          >`
          SELECT EXISTS (
            SELECT 1
            FROM pg_stat_activity AS activity
            WHERE activity.datname = current_database()
              AND ${lockedRow!.pid} = ANY(
                pg_blocking_pids(activity.pid)
              )
          ) AS is_blocked
        `;

          if (state?.is_blocked) {
            observedBlocking = true;
            break;
          }

          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        }

        // Transaction A commits after leaving this callback.
      },
      { timeout: 15_000 },
    );

    const completionResult = await completionPromise;

    expect(observedBlocking).toBe(true);

    expect(completionResult).toEqual({
      status: 'HAS_UNFINISHED_WORKOUTS',
      unfinishedCount: 1,
    });

    const assignment = await prisma.trainingProgramAssignment.findUniqueOrThrow(
      {
        where: { id: fixture.assignmentId },
        select: {
          status: true,
          completedAt: true,
        },
      },
    );

    expect(assignment).toEqual({
      status: 'ACTIVE',
      completedAt: null,
    });

    const workouts = await prisma.workout.findMany({
      where: {
        programAssignmentId: fixture.assignmentId,
      },
      select: {
        status: true,
      },
    });

    expect(workouts).toEqual([{ status: 'PLANNED' }]);
  }, 20_000);
});
