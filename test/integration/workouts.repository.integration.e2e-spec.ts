import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaModule, PrismaService } from '../../src/database/index.js';
import { WorkoutsModule } from '../../src/modules/workouts/workouts.module.js';
import { WorkoutsRepository } from '../../src/modules/workouts/workouts.repository.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

describe('WorkoutsRepository.createFromProgram integration (e2e)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  let repository: WorkoutsRepository;

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
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    await app.init();

    prisma = app.get(PrismaService);
    repository = app.get(WorkoutsRepository);
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
});
