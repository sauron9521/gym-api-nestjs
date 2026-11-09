import { randomUUID } from 'node:crypto';

import { BadRequestException, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaModule, PrismaService } from '../../src/infra/database/index.js';
import { TrainingProgramVersionRepository } from '../../src/modules/training-programs/repositories/training-program-version.repository.js';
import { TrainingProgramExerciseRepository } from '../../src/modules/training-programs/repositories/training-program-exercise.repository.js';
import { TrainingProgramAssignmentRepository } from '../../src/modules/training-programs/repositories/training-program-assignment.repository.js';
import { WorkoutsRepository } from '../../src/modules/workouts/repositories/workouts.repository.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

/**
 * Real PostgreSQL publication integrity checks, including a deterministic
 * archive/publication race. Only repository boundaries are exercised; no
 * Prisma, controller, or transaction mocks are used.
 */
describe('Published training program integrity (PostgreSQL)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  let versions: TrainingProgramVersionRepository;
  let exercises: TrainingProgramExerciseRepository;
  let assignments: TrainingProgramAssignmentRepository;
  let workouts: WorkoutsRepository;

  const cleanup = {
    userIds: [] as string[],
    programIds: [] as string[],
    exerciseIds: [] as string[],
    relationshipIds: [] as string[],
    assignmentIds: [] as string[],
  };

  async function fixture(source: 'GLOBAL' | 'TRAINER_CUSTOM' | 'ATHLETE_CUSTOM' = 'GLOBAL') {
    const suffix = randomUUID();
    const trainer = await prisma.user.create({
      data: {
        email: `program-integrity-trainer-${suffix}@example.test`,
        passwordHash: 'test-hash',
        role: 'TRAINER',
      },
      select: { id: true },
    });
    cleanup.userIds.push(trainer.id);

    const athlete = await prisma.user.create({
      data: {
        email: `program-integrity-athlete-${suffix}@example.test`,
        passwordHash: 'test-hash',
        role: 'ATHLETE',
      },
      select: { id: true },
    });
    cleanup.userIds.push(athlete.id);

    const program = await prisma.trainingProgram.create({
      data: { trainerId: trainer.id, status: 'DRAFT' },
      select: { id: true },
    });
    cleanup.programIds.push(program.id);

    const version = await prisma.trainingProgramVersion.create({
      data: {
        programId: program.id,
        version: 1,
        title: 'Publication integrity regression',
        status: 'DRAFT',
        durationWeeks: 2,
      },
      select: { id: true },
    });
    const workout = await prisma.trainingProgramWorkout.create({
      data: {
        versionId: version.id,
        weekNumber: 1,
        dayNumber: 1,
        title: 'Upper Body',
      },
      select: { id: true },
    });
    const exercise = await prisma.exercise.create({
      data: {
        name: 'Integrity Reference',
        source,
        exerciseType: 'STRENGTH',
        ...(source === 'TRAINER_CUSTOM'
          ? { createdById: trainer.id }
          : source === 'ATHLETE_CUSTOM'
            ? { createdById: athlete.id, visibility: 'PRIVATE' as const }
            : {}),
      },
      select: { id: true },
    });
    cleanup.exerciseIds.push(exercise.id);

    const programExercise = await prisma.trainingProgramExercise.create({
      data: {
        workoutId: workout.id,
        exerciseId: exercise.id,
        exerciseNameSnapshot: 'Integrity Reference Snapshot',
        exerciseTypeSnapshot: 'STRENGTH',
        sortOrder: 0,
      },
      select: { id: true },
    });
    await prisma.trainingProgramSet.create({
      data: {
        programExerciseId: programExercise.id,
        setNumber: 1,
        setType: 'WORKING',
        plannedReps: 8,
      },
    });
    return {
      trainerId: trainer.id,
      athleteId: athlete.id,
      programId: program.id,
      versionId: version.id,
      programWorkoutId: workout.id,
      programExerciseId: programExercise.id,
      exerciseId: exercise.id,
    };
  }

  beforeAll(async () => {
    useTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [await ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    versions = new TrainingProgramVersionRepository(prisma);
    exercises = new TrainingProgramExerciseRepository(prisma);
    assignments = new TrainingProgramAssignmentRepository(prisma);
    workouts = new WorkoutsRepository(prisma);
  }, 20_000);

  afterAll(async () => {
    try {
      if (!prisma) return;
      if (cleanup.userIds.length > 0) {
        await prisma.workout.deleteMany({
          where: { athleteId: { in: cleanup.userIds } },
        });
      }
      if (cleanup.assignmentIds.length > 0) {
        await prisma.trainingProgramAssignment.deleteMany({
          where: { id: { in: cleanup.assignmentIds } },
        });
      }
      if (cleanup.programIds.length > 0) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId: { in: cleanup.programIds } },
        });
        await prisma.trainingProgram.deleteMany({
          where: { id: { in: cleanup.programIds } },
        });
      }
      if (cleanup.relationshipIds.length > 0) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: { in: cleanup.relationshipIds } },
        });
      }
      if (cleanup.exerciseIds.length > 0) {
        await prisma.exercise.deleteMany({
          where: { id: { in: cleanup.exerciseIds } },
        });
      }
      if (cleanup.userIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: cleanup.userIds } },
        });
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('rejects an already archived source without publishing any part of the version', async () => {
    const data = await fixture();
    await prisma.exercise.update({
      where: { id: data.exerciseId },
      data: { isArchived: true },
    });
    await expect(
      versions.publishVersion(data.programId, data.versionId),
    ).rejects.toThrow('A program references unavailable exercises');

    const [version, program] = await Promise.all([
      prisma.trainingProgramVersion.findUniqueOrThrow({
        where: { id: data.versionId },
        select: { status: true, publishedAt: true },
      }),
      prisma.trainingProgram.findUniqueOrThrow({
        where: { id: data.programId },
        select: { status: true },
      }),
    ]);
    expect(version).toEqual({ status: 'DRAFT', publishedAt: null });
    expect(program.status).toBe('DRAFT');
  });

  it('rejects a draft with an athlete-owned source even when it is not archived', async () => {
    const data = await fixture('ATHLETE_CUSTOM');
    await expect(
      versions.publishVersion(data.programId, data.versionId),
    ).rejects.toThrow('A program references unavailable exercises');
    expect(await prisma.trainingProgramVersion.findUniqueOrThrow({
      where: { id: data.versionId },
      select: { status: true },
    })).toEqual({ status: 'DRAFT' });
  });

  it.each(['GLOBAL', 'TRAINER_CUSTOM'] as const)(
    'publishes valid %s sources, preserves snapshots and prohibits subsequent draft writes',
    async (source) => {
      const data = await fixture(source);
      const published = await versions.publishVersion(data.programId, data.versionId);
      expect(published).toMatchObject({
        id: data.versionId,
        status: 'PUBLISHED',
        workouts: [{
          id: data.programWorkoutId,
          exercises: [{
            id: data.programExerciseId,
            exerciseId: data.exerciseId,
            exerciseNameSnapshot: 'Integrity Reference Snapshot',
            sets: [{ plannedReps: 8 }],
          }],
        }],
      });

      await expect(exercises.updateProgramExercise(
        data.programId,
        data.versionId,
        data.programWorkoutId,
        data.programExerciseId,
        { notes: 'Unauthorized post-publication change' },
      )).rejects.toMatchObject({ code: 'P2025' });

      const versionAfter = await prisma.trainingProgramVersion.findUniqueOrThrow({
        where: { id: data.versionId },
        select: {
          status: true,
          workouts: {
            select: { exercises: { select: { notes: true, exerciseNameSnapshot: true } } },
          },
        },
      });
      expect(versionAfter.status).toBe('PUBLISHED');
      expect(versionAfter.workouts[0]?.exercises[0]).toEqual({
        notes: null,
        exerciseNameSnapshot: 'Integrity Reference Snapshot',
      });

      // A valid published version remains assignable and its immutable
      // exercise snapshot is copied into a fresh planned workout.
      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId: data.trainerId,
          athleteId: data.athleteId,
          initiatedById: data.trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      cleanup.relationshipIds.push(relationship.id);

      const assigned = await assignments.createAssignmentForActiveRelationship({
        programId: data.programId,
        versionId: data.versionId,
        trainerAthleteId: relationship.id,
        trainerId: data.trainerId,
        athleteId: data.athleteId,
      });
      expect(assigned).not.toBeNull();
      cleanup.assignmentIds.push(assigned!.id);

      const planned = await workouts.createFromProgram({
        athleteId: data.athleteId,
        assignmentId: assigned!.id,
        programWorkoutId: data.programWorkoutId,
      });
      expect(planned).toMatchObject({
        status: 'PLANNED',
        exercises: [{
          exerciseId: data.exerciseId,
          exerciseNameSnapshot: 'Integrity Reference Snapshot',
        }],
      });
    },
  );

  it('serializes publishing against an archive that commits first', async () => {
    const data = await fixture();
    let publishPromise: Promise<'PUBLISHED' | 'DENIED' | 'OTHER'> | undefined;
    let wasBlocked = false;

    await prisma.$transaction(async (tx) => {
      const [holder] = await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid()::integer AS pid
        FROM "exercises"
        WHERE "id" = ${data.exerciseId}
        FOR UPDATE
      `;
      expect(holder).toBeDefined();

      publishPromise = versions.publishVersion(data.programId, data.versionId).then(
        (result) => result?.status === 'PUBLISHED'
          ? 'PUBLISHED' as const
          : 'OTHER' as const,
        (error: unknown) => error instanceof BadRequestException
          ? 'DENIED' as const
          : 'OTHER' as const,
      );

      for (let attempt = 0; attempt < 60; attempt++) {
        const [state] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity AS activity
            WHERE activity.datname = current_database()
              AND ${holder!.pid} = ANY(pg_blocking_pids(activity.pid))
          ) AS blocked
        `;
        if (state?.blocked) {
          wasBlocked = true;
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }

      await tx.exercise.update({
        where: { id: data.exerciseId },
        data: { isArchived: true },
      });
    }, { timeout: 15_000 });

    expect(wasBlocked).toBe(true);
    expect(await publishPromise).toBe('DENIED');
    const [version, program] = await Promise.all([
      prisma.trainingProgramVersion.findUniqueOrThrow({
        where: { id: data.versionId },
        select: { status: true, publishedAt: true },
      }),
      prisma.trainingProgram.findUniqueOrThrow({
        where: { id: data.programId },
        select: { status: true },
      }),
    ]);
    expect(version).toEqual({ status: 'DRAFT', publishedAt: null });
    expect(program).toEqual({ status: 'DRAFT' });
  }, 20_000);
});
