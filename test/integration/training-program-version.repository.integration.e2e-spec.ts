import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { PrismaModule, PrismaService } from '../../src/infra/database/index.js';
import { TrainingProgramVersionRepository } from '../../src/modules/training-programs/repositories/training-program-version.repository.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

describe('TrainingProgramVersionRepository integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: TrainingProgramVersionRepository;
  let fixtureExerciseId: string;

  beforeAll(async () => {
    useTestDatabase();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
      providers: [TrainingProgramVersionRepository],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    repository = app.get(TrainingProgramVersionRepository);
    const fixtureExercise = await prisma.exercise.create({
      data: {
        name: `Publication Fixture ${randomUUID()}`,
        source: 'GLOBAL',
        exerciseType: 'STRENGTH',
      },
      select: { id: true },
    });
    fixtureExerciseId = fixtureExercise.id;
  }, 20_000);

  afterAll(async () => {
    if (fixtureExerciseId) {
      await prisma.exercise.delete({ where: { id: fixtureExerciseId } });
    }
    await app?.close();
  }, 20_000);

  async function addPublishableWorkout(versionId: string, weekNumber = 1) {
    return prisma.trainingProgramWorkout.create({
      data: {
        versionId,
        weekNumber,
        dayNumber: 1,
        title: 'Test workout',
        exercises: {
          create: {
            exercise: { connect: { id: fixtureExerciseId } },
            exerciseNameSnapshot: 'Publication Fixture',
            exerciseTypeSnapshot: 'STRENGTH',
            sortOrder: 0,
            sets: {
              create: { setNumber: 1, setType: 'WORKING', plannedReps: 8 },
            },
          },
        },
      },
    });
  }

  it('rolls back version publication when the program is archived', async () => {
    let trainerId: string | undefined;
    let programId: string | undefined;

    try {
      const trainer = await prisma.user.create({
        data: {
          email: `rollback-${randomUUID()}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
        select: { id: true },
      });

      trainerId = trainer.id;

      const program = await prisma.trainingProgram.create({
        data: {
          trainerId,
          status: 'ARCHIVED',
          versions: {
            create: {
              version: 1,
              title: 'Rollback Test Program',
              status: 'DRAFT',
            },
          },
        },
        select: {
          id: true,
          versions: {
            select: { id: true },
          },
        },
      });

      programId = program.id;

      const versionId = program.versions[0]!.id;

      await addPublishableWorkout(versionId);

      const result = await repository.publishVersion(programId, versionId);

      expect(result).toBeNull();

      const persistedVersion =
        await prisma.trainingProgramVersion.findUniqueOrThrow({
          where: { id: versionId },
          select: {
            status: true,
            publishedAt: true,
          },
        });

      expect(persistedVersion).toEqual({
        status: 'DRAFT',
        publishedAt: null,
      });

      const persistedProgram = await prisma.trainingProgram.findUniqueOrThrow({
        where: { id: programId },
        select: { status: true },
      });

      expect(persistedProgram.status).toBe('ARCHIVED');
    } finally {
      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });

        await prisma.trainingProgram.delete({
          where: { id: programId },
        });
      }

      if (trainerId) {
        await prisma.user.delete({
          where: { id: trainerId },
        });
      }
    }
  });

  it('commits version and program publication successfully', async () => {
    let trainerId: string | undefined;
    let programId: string | undefined;

    try {
      const trainer = await prisma.user.create({
        data: {
          email: `publish-${randomUUID()}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
        select: { id: true },
      });

      trainerId = trainer.id;

      const program = await prisma.trainingProgram.create({
        data: {
          trainerId,
          status: 'DRAFT',
          versions: {
            create: {
              version: 1,
              title: 'Publication Test Program',
              status: 'DRAFT',
            },
          },
        },
        select: {
          id: true,
          versions: {
            select: { id: true },
          },
        },
      });

      programId = program.id;
      const versionId = program.versions[0]!.id;

      await addPublishableWorkout(versionId);

      // Act
      const result = await repository.publishVersion(programId, versionId);

      // Assert: repository response
      expect(result).toMatchObject({
        id: versionId,
        programId,
        version: 1,
        status: 'PUBLISHED',
      });

      expect(result?.publishedAt).toBeInstanceOf(Date);

      // Assert: persisted version
      const persistedVersion =
        await prisma.trainingProgramVersion.findUniqueOrThrow({
          where: { id: versionId },
          select: {
            status: true,
            publishedAt: true,
          },
        });

      expect(persistedVersion.status).toBe('PUBLISHED');
      expect(persistedVersion.publishedAt).toBeInstanceOf(Date);
      expect(persistedVersion.publishedAt).toEqual(result?.publishedAt);

      // Assert: persisted program
      const persistedProgram = await prisma.trainingProgram.findUniqueOrThrow({
        where: { id: programId },
        select: { status: true },
      });

      expect(persistedProgram.status).toBe('PUBLISHED');
    } finally {
      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });

        await prisma.trainingProgram.delete({
          where: { id: programId },
        });
      }

      if (trainerId) {
        await prisma.user.delete({
          where: { id: trainerId },
        });
      }
    }
  });

  it('rejects an invalid draft after acquiring the publication lock', async () => {
    const trainer = await prisma.user.create({
      data: {
        email: `invalid-publish-${randomUUID()}@example.com`,
        passwordHash: 'test-password-hash',
        role: 'TRAINER',
      },
      select: { id: true },
    });
    let programId: string | undefined;

    try {
      const program = await prisma.trainingProgram.create({
        data: {
          trainerId: trainer.id,
          versions: {
            create: { version: 1, title: 'Empty Draft', status: 'DRAFT' },
          },
        },
        select: { id: true, versions: { select: { id: true } } },
      });
      programId = program.id;
      const versionId = program.versions[0]!.id;

      await expect(repository.publishVersion(program.id, versionId))
        .rejects.toThrow('A program must contain at least one workout');

      const saved = await prisma.trainingProgramVersion.findUniqueOrThrow({
        where: { id: versionId },
        select: { status: true, publishedAt: true },
      });
      expect(saved).toEqual({ status: 'DRAFT', publishedAt: null });
    } finally {
      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });
        await prisma.trainingProgram.delete({ where: { id: programId } });
      }
      await prisma.user.delete({ where: { id: trainer.id } });
    }
  });

  it('does not shrink duration below the last workout week', async () => {
    const trainer = await prisma.user.create({
      data: {
        email: `duration-publish-${randomUUID()}@example.com`,
        passwordHash: 'test-password-hash',
        role: 'TRAINER',
      },
      select: { id: true },
    });
    let programId: string | undefined;

    try {
      const program = await prisma.trainingProgram.create({
        data: {
          trainerId: trainer.id,
          versions: {
            create: {
              version: 1,
              title: 'Duration Invariant',
              durationWeeks: 6,
              status: 'DRAFT',
            },
          },
        },
        select: { id: true, versions: { select: { id: true } } },
      });
      programId = program.id;
      const versionId = program.versions[0]!.id;
      await addPublishableWorkout(versionId, 5);

      await expect(
        repository.updateVersion(
          { id: versionId, programId, status: 'DRAFT' },
          { durationWeeks: 4 },
        ),
      ).rejects.toThrow('A workout week cannot exceed the program duration');

      const saved = await prisma.trainingProgramVersion.findUniqueOrThrow({
        where: { id: versionId },
        select: { durationWeeks: true, status: true },
      });
      expect(saved).toEqual({ durationWeeks: 6, status: 'DRAFT' });
    } finally {
      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });
        await prisma.trainingProgram.delete({ where: { id: programId } });
      }
      await prisma.user.delete({ where: { id: trainer.id } });
    }
  });

  it('creates a draft with independent copies of workouts, exercises and sets', async () => {
    let trainerId: string | undefined;
    let programId: string | undefined;
    let exerciseId: string | undefined;

    try {
      const trainer = await prisma.user.create({
        data: {
          email: `draft-copy-${randomUUID()}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
        select: { id: true },
      });

      trainerId = trainer.id;

      const exercise = await prisma.exercise.create({
        data: {
          name: 'Bench Press',
          source: 'GLOBAL',
          exerciseType: 'STRENGTH',
        },
        select: { id: true },
      });

      exerciseId = exercise.id;

      const program = await prisma.trainingProgram.create({
        data: {
          trainerId,
          status: 'PUBLISHED',
        },
        select: { id: true },
      });

      programId = program.id;

      const version = await prisma.trainingProgramVersion.create({
        data: {
          programId,
          version: 1,
          title: 'Strength Program',
          description: 'Progressive overload',
          durationWeeks: 6,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
        select: { id: true },
      });

      const workout = await prisma.trainingProgramWorkout.create({
        data: {
          versionId: version.id,
          weekNumber: 1,
          dayNumber: 1,
          title: 'Upper Body',
          notes: 'Heavy day',
        },
        select: { id: true },
      });

      const programExercise = await prisma.trainingProgramExercise.create({
        data: {
          workoutId: workout.id,
          exerciseId,
          exerciseNameSnapshot: 'Bench Press',
          exerciseTypeSnapshot: 'STRENGTH',
          sortOrder: 0,
          notes: 'Controlled movement',
        },
        select: { id: true },
      });

      await prisma.trainingProgramSet.create({
        data: {
          programExerciseId: programExercise.id,
          setNumber: 1,
          setType: 'WORKING',
          plannedReps: 8,
          plannedWeightKg: 80,
          restSeconds: 120,
          targetRpe: 8,
          targetRir: 2,
        },
      });

      // Clone a nontrivial tree: multiple weeks, exercises and sets with
      // distinct load, time, distance, target and notes values.
      await prisma.trainingProgramSet.create({
        data: {
          programExerciseId: programExercise.id,
          setNumber: 2,
          setType: 'WARMUP',
          plannedReps: 12,
          plannedWeightKg: '42.75',
          plannedDurationSeconds: 75,
          plannedDistanceMeters: '125.55',
          restSeconds: 45,
          targetRpe: '6.5',
          targetRir: 3,
          notes: 'Warm-up with distance and duration',
        },
      });
      await prisma.trainingProgramExercise.create({
        data: {
          workoutId: workout.id,
          exerciseId,
          exerciseNameSnapshot: 'Bench Press – second exercise slot',
          exerciseTypeSnapshot: 'STRENGTH',
          sortOrder: 1,
          notes: 'Second exercise notes',
          sets: {
            create: [
              {
                setNumber: 1,
                setType: 'WORKING',
                plannedReps: 6,
                plannedWeightKg: '92.25',
                restSeconds: 180,
                targetRpe: '8.5',
                targetRir: 1,
              },
              {
                setNumber: 2,
                setType: 'DROP_SET',
                plannedReps: 12,
                plannedWeightKg: '57.50',
                restSeconds: 60,
                targetRpe: '7.5',
                notes: 'Drop set',
              },
            ],
          },
        },
      });
      await prisma.trainingProgramWorkout.create({
        data: {
          versionId: version.id,
          weekNumber: 2,
          dayNumber: 2,
          title: 'Week 2 — Strength',
          notes: 'Progression session',
          exercises: {
            create: {
              exerciseId,
              exerciseNameSnapshot: 'Alternate week snapshot',
              exerciseTypeSnapshot: 'STRENGTH',
              sortOrder: 0,
              notes: 'Different week',
              sets: {
                create: [
                  {
                    setNumber: 1,
                    setType: 'WARMUP',
                    plannedReps: 10,
                    plannedWeightKg: '40.25',
                  },
                  {
                    setNumber: 2,
                    setType: 'WORKING',
                    plannedReps: 5,
                    plannedWeightKg: '100.75',
                    restSeconds: 240,
                    targetRpe: '9.0',
                    targetRir: 1,
                  },
                ],
              },
            },
          },
        },
      });

      // Arrange: snapshot of the original published version
      const sourceBefore = await repository.findVersionById(version.id);

      expect(sourceBefore).not.toBeNull();

      // Act
      const draft = await repository.createDraftFromLatestPublished(programId);

      expect(draft).not.toBeNull();

      if (!sourceBefore || !draft) {
        throw new Error('Expected source and draft versions');
      }

      // Assert: new version
      expect(draft).toMatchObject({
        programId,
        version: 2,
        title: 'Strength Program',
        description: 'Progressive overload',
        durationWeeks: 6,
        status: 'DRAFT',
        publishedAt: null,
      });

      expect(draft.id).not.toBe(sourceBefore.id);

      // Assert: workout copy
      expect(draft.workouts).toHaveLength(2);

      const sourceWorkout = sourceBefore.workouts[0]!;
      const copiedWorkout = draft.workouts[0]!;

      expect(copiedWorkout.id).not.toBe(sourceWorkout.id);

      expect(copiedWorkout).toMatchObject({
        weekNumber: 1,
        dayNumber: 1,
        title: 'Upper Body',
        notes: 'Heavy day',
        versionId: draft.id,
      });

      // Assert: exercise copy
      expect(copiedWorkout.exercises).toHaveLength(2);

      const sourceExercise = sourceWorkout.exercises[0]!;
      const copiedExercise = copiedWorkout.exercises[0]!;

      expect(copiedExercise.id).not.toBe(sourceExercise.id);

      expect(copiedExercise).toMatchObject({
        workoutId: copiedWorkout.id,
        exerciseId,
        exerciseNameSnapshot: 'Bench Press',
        exerciseTypeSnapshot: 'STRENGTH',
        sortOrder: 0,
        notes: 'Controlled movement',
      });

      // Assert: set copy
      expect(copiedExercise.sets).toHaveLength(2);

      const sourceSet = sourceExercise.sets[0]!;
      const copiedSet = copiedExercise.sets[0]!;

      expect(copiedSet.id).not.toBe(sourceSet.id);

      expect(copiedSet).toMatchObject({
        programExerciseId: copiedExercise.id,
        setNumber: 1,
        setType: 'WORKING',
        plannedReps: 8,
        restSeconds: 120,
        targetRir: 2,
      });

      expect(copiedSet.plannedWeightKg?.toString()).toBe('80');
      expect(copiedSet.targetRpe?.toString()).toBe('8');

      // Compare every domain field for every copied workout, exercise and
      // set. UUIDs, relation parent IDs and timestamps are expected to differ.
      const contentOf = (tree: NonNullable<typeof sourceBefore>) =>
        tree.workouts.map((workoutItem) => ({
          weekNumber: workoutItem.weekNumber,
          dayNumber: workoutItem.dayNumber,
          title: workoutItem.title,
          notes: workoutItem.notes,
          exercises: workoutItem.exercises.map((exerciseItem) => ({
            exerciseId: exerciseItem.exerciseId,
            exerciseNameSnapshot: exerciseItem.exerciseNameSnapshot,
            exerciseTypeSnapshot: exerciseItem.exerciseTypeSnapshot,
            sortOrder: exerciseItem.sortOrder,
            notes: exerciseItem.notes,
            sets: exerciseItem.sets.map((set) => ({
              setNumber: set.setNumber,
              setType: set.setType,
              plannedReps: set.plannedReps,
              plannedWeightKg: set.plannedWeightKg?.toString() ?? null,
              plannedDurationSeconds: set.plannedDurationSeconds,
              plannedDistanceMeters: set.plannedDistanceMeters?.toString() ?? null,
              restSeconds: set.restSeconds,
              targetRpe: set.targetRpe?.toString() ?? null,
              targetRir: set.targetRir,
              notes: set.notes,
            })),
          })),
        }));
      expect(contentOf(draft)).toEqual(contentOf(sourceBefore));
      expect(
        draft.workouts.flatMap((item) => item.exercises)
          .flatMap((item) => item.sets).length,
      ).toBe(6);

      for (const [index, sourceWorkout] of sourceBefore.workouts.entries()) {
        const clonedWorkout = draft.workouts[index]!;
        expect(clonedWorkout.id).not.toBe(sourceWorkout.id);
        for (const [exerciseIndex, original] of sourceWorkout.exercises.entries()) {
          const clonedExercise = clonedWorkout.exercises[exerciseIndex]!;
          expect(clonedExercise.id).not.toBe(original.id);
          for (const [setIndex, originalSet] of original.sets.entries()) {
            expect(clonedExercise.sets[setIndex]!.id).not.toBe(originalSet.id);
            expect(clonedExercise.sets[setIndex]!.programExerciseId).toBe(clonedExercise.id);
          }
        }
      }

      // Changing the editable copy cannot mutate the source published tree.
      await prisma.trainingProgramSet.update({
        where: { id: draft.workouts[0]!.exercises[0]!.sets[0]!.id },
        data: { plannedReps: 99 },
      });
      const unchangedSource = await repository.findVersionById(version.id);
      expect(unchangedSource).toEqual(sourceBefore);

      // Assert: changes are persisted in PostgreSQL
      const persistedDraft = await repository.findVersionById(draft.id);

      expect(persistedDraft?.workouts[0]?.exercises[0]?.sets[0]?.plannedReps).toBe(99);
      expect(persistedDraft?.id).toBe(draft.id);

      // Assert: original published version is unchanged
      const sourceAfter = await repository.findVersionById(version.id);

      expect(sourceAfter).toEqual(sourceBefore);
    } finally {
      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });

        await prisma.trainingProgram.deleteMany({
          where: { id: programId },
        });
      }

      if (exerciseId) {
        await prisma.exercise.deleteMany({
          where: { id: exerciseId },
        });
      }

      if (trainerId) {
        await prisma.user.deleteMany({
          where: { id: trainerId },
        });
      }
    }
  });

  it('does not create duplicate drafts under concurrent requests', async () => {
    let trainerId: string | undefined;
    let programId: string | undefined;

    try {
      const trainer = await prisma.user.create({
        data: {
          email: `concurrent-draft-${randomUUID()}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
        select: { id: true },
      });

      trainerId = trainer.id;

      const program = await prisma.trainingProgram.create({
        data: {
          trainerId,
          status: 'PUBLISHED',
          versions: {
            create: {
              version: 1,
              title: 'Concurrent Draft Test',
              status: 'PUBLISHED',
              publishedAt: new Date(),
              workouts: {
                create: {
                  weekNumber: 1,
                  dayNumber: 1,
                  title: 'Full Body',
                },
              },
            },
          },
        },
        select: { id: true },
      });

      programId = program.id;

      // Act: two concurrent requests
      // Both calls must settle normally. The parent FOR UPDATE lock makes
      // the second request observe the first committed draft rather than
      // leaking a uniqueness violation from PostgreSQL.
      const results = await Promise.all([
        repository.createDraftFromLatestPublished(programId),
        repository.createDraftFromLatestPublished(programId),
      ]);

      const created = results.filter((result) => result !== null);
      expect(results).toContain(null);

      expect(created).toHaveLength(1);

      expect(created[0]).toMatchObject({
        programId,
        version: 2,
        status: 'DRAFT',
      });

      // Verify actual database state
      const persistedDrafts = await prisma.trainingProgramVersion.findMany({
        where: {
          programId,
          status: 'DRAFT',
        },
        select: {
          id: true,
          version: true,
        },
      });

      expect(persistedDrafts).toEqual([
        {
          id: created[0]!.id,
          version: 2,
        },
      ]);
    } finally {
      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });

        await prisma.trainingProgram.delete({
          where: { id: programId },
        });
      }

      if (trainerId) {
        await prisma.user.delete({
          where: { id: trainerId },
        });
      }
    }
  });

  it('waits for a program archive and does not clone when archival commits first', async () => {
    let trainerId: string | undefined;
    let programId: string | undefined;

    try {
      const trainer = await prisma.user.create({
        data: {
          email: `archive-clone-race-${randomUUID()}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
        select: { id: true },
      });
      trainerId = trainer.id;

      const program = await prisma.trainingProgram.create({
        data: {
          trainerId,
          status: 'PUBLISHED',
          versions: {
            create: {
              version: 1,
              title: 'Cannot clone archived program',
              status: 'PUBLISHED',
              publishedAt: new Date(),
            },
          },
        },
        select: { id: true },
      });
      programId = program.id;
      let clonePromise: ReturnType<
        TrainingProgramVersionRepository['createDraftFromLatestPublished']
      > | undefined;
      let observedBlock = false;

      await prisma.$transaction(async (tx) => {
        const [holder] = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid()::integer AS pid
          FROM "training_programs"
          WHERE "id" = ${programId}
          FOR UPDATE
        `;
        expect(holder).toBeDefined();

        clonePromise = repository.createDraftFromLatestPublished(programId!);

        // Confirm an actual DB lock wait, not a timer-based coincidence.
        for (let attempt = 0; attempt < 60; attempt++) {
          const [state] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity AS activity
              WHERE activity.datname = current_database()
                AND ${holder!.pid} = ANY(pg_blocking_pids(activity.pid))
            ) AS blocked
          `;
          if (state?.blocked) {
            observedBlock = true;
            break;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        }

        await tx.trainingProgram.update({
          where: { id: programId },
          data: { status: 'ARCHIVED' },
        });
      }, { timeout: 15_000 });

      expect(observedBlock).toBe(true);
      expect(await clonePromise).toBeNull();
      expect(await prisma.trainingProgramVersion.count({
        where: { programId, status: 'DRAFT' },
      })).toBe(0);

      const persisted = await prisma.trainingProgram.findUniqueOrThrow({
        where: { id: programId },
        select: { status: true },
      });
      expect(persisted.status).toBe('ARCHIVED');
    } finally {
      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });
        await prisma.trainingProgram.delete({
          where: { id: programId },
        });
      }
      if (trainerId) {
        await prisma.user.delete({ where: { id: trainerId } });
      }
    }
  }, 20_000);

  it('enforces one draft per program regardless of version number', async () => {
    let trainerId: string | undefined;
    let programId: string | undefined;

    try {
      const trainer = await prisma.user.create({
        data: {
          email: `unique-draft-${randomUUID()}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
        select: { id: true },
      });

      trainerId = trainer.id;

      const program = await prisma.trainingProgram.create({
        data: {
          trainerId,
          status: 'DRAFT',
        },
        select: { id: true },
      });

      programId = program.id;

      // First draft: version 1
      const firstDraft = await prisma.trainingProgramVersion.create({
        data: {
          programId,
          version: 1,
          title: 'First Draft',
          status: 'DRAFT',
        },
      });

      expect(firstDraft.status).toBe('DRAFT');

      // Second draft: version 2
      // Different version number, same program.
      await expect(
        prisma.trainingProgramVersion.create({
          data: {
            programId,
            version: 2,
            title: 'Second Draft',
            status: 'DRAFT',
          },
        }),
      ).rejects.toMatchObject({
        code: 'P2002',
      });

      // Verify database state
      const drafts = await prisma.trainingProgramVersion.findMany({
        where: {
          programId,
          status: 'DRAFT',
        },
        select: {
          id: true,
          version: true,
          status: true,
        },
      });

      expect(drafts).toEqual([
        {
          id: firstDraft.id,
          version: 1,
          status: 'DRAFT',
        },
      ]);

      // Published versions remain allowed.
      const published = await prisma.trainingProgramVersion.create({
        data: {
          programId,
          version: 2,
          title: 'Published Version',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });

      expect(published.status).toBe('PUBLISHED');
    } finally {
      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });

        await prisma.trainingProgram.delete({
          where: { id: programId },
        });
      }

      if (trainerId) {
        await prisma.user.delete({
          where: { id: trainerId },
        });
      }
    }
  });

  it('creates a new draft after publishing the previous one', async () => {
    let trainerId: string | undefined;
    let programId: string | undefined;

    try {
      const trainer = await prisma.user.create({
        data: {
          email: `version-lifecycle-${randomUUID()}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
        select: { id: true },
      });

      trainerId = trainer.id;

      // Initial state: v1 published, v2 draft
      const program = await prisma.trainingProgram.create({
        data: {
          trainerId,
          status: 'PUBLISHED',
          versions: {
            create: [
              {
                version: 1,
                title: 'Original Program',
                status: 'PUBLISHED',
                publishedAt: new Date(),
              },
              {
                version: 2,
                title: 'Updated Program',
                status: 'DRAFT',
              },
            ],
          },
        },
        select: { id: true },
      });

      programId = program.id;

      const version2 = await prisma.trainingProgramVersion.findUniqueOrThrow({
        where: {
          programId_version: {
            programId,
            version: 2,
          },
        },
        select: { id: true },
      });

      await addPublishableWorkout(version2.id);

      // Step 1: publish version 2
      const published = await repository.publishVersion(programId, version2.id);

      expect(published).toMatchObject({
        id: version2.id,
        version: 2,
        status: 'PUBLISHED',
      });

      expect(published?.publishedAt).toBeInstanceOf(Date);

      // Step 2: create version 3 from latest published
      const draft = await repository.createDraftFromLatestPublished(programId);

      expect(draft).toMatchObject({
        programId,
        version: 3,
        title: 'Updated Program',
        status: 'DRAFT',
        publishedAt: null,
      });

      expect(draft?.id).not.toBe(version2.id);

      // Step 3: inspect persisted versions
      const versions = await prisma.trainingProgramVersion.findMany({
        where: { programId },
        orderBy: { version: 'asc' },
        select: {
          version: true,
          title: true,
          status: true,
          publishedAt: true,
        },
      });

      expect(
        versions.map(({ version, title, status }) => ({
          version,
          title,
          status,
        })),
      ).toEqual([
        {
          version: 1,
          title: 'Original Program',
          status: 'PUBLISHED',
        },
        {
          version: 2,
          title: 'Updated Program',
          status: 'PUBLISHED',
        },
        {
          version: 3,
          title: 'Updated Program',
          status: 'DRAFT',
        },
      ]);

      expect(versions[0]?.publishedAt).toBeInstanceOf(Date);
      expect(versions[1]?.publishedAt).toBeInstanceOf(Date);
      expect(versions[2]?.publishedAt).toBeNull();

      // Exactly one active draft
      const draftCount = await prisma.trainingProgramVersion.count({
        where: {
          programId,
          status: 'DRAFT',
        },
      });

      expect(draftCount).toBe(1);
    } finally {
      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });

        await prisma.trainingProgram.delete({
          where: { id: programId },
        });
      }

      if (trainerId) {
        await prisma.user.delete({
          where: { id: trainerId },
        });
      }
    }
  });

  it('allows only one concurrent publication of the same draft', async () => {
    let trainerId: string | undefined;
    let programId: string | undefined;

    try {
      const trainer = await prisma.user.create({
        data: {
          email: `concurrent-publish-${randomUUID()}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
        select: { id: true },
      });

      trainerId = trainer.id;

      const program = await prisma.trainingProgram.create({
        data: {
          trainerId,
          status: 'DRAFT',
          versions: {
            create: {
              version: 1,
              title: 'Concurrent Publication Test',
              status: 'DRAFT',
            },
          },
        },
        select: {
          id: true,
          versions: {
            select: { id: true },
          },
        },
      });

      programId = program.id;
      const versionId = program.versions[0]!.id;

      await addPublishableWorkout(versionId);

      // Act: two simultaneous publication attempts
      const results = await Promise.all([
        repository.publishVersion(programId, versionId),
        repository.publishVersion(programId, versionId),
      ]);

      // Exactly one operation should succeed
      const successful = results.filter((result) => result !== null);

      const unsuccessful = results.filter((result) => result === null);

      expect(successful).toHaveLength(1);
      expect(unsuccessful).toHaveLength(1);

      expect(successful[0]).toMatchObject({
        id: versionId,
        programId,
        version: 1,
        status: 'PUBLISHED',
      });

      // Assert: persisted version
      const persistedVersion =
        await prisma.trainingProgramVersion.findUniqueOrThrow({
          where: { id: versionId },
          select: {
            status: true,
            publishedAt: true,
          },
        });

      expect(persistedVersion.status).toBe('PUBLISHED');
      expect(persistedVersion.publishedAt).toBeInstanceOf(Date);

      // Assert: program status
      const persistedProgram = await prisma.trainingProgram.findUniqueOrThrow({
        where: { id: programId },
        select: { status: true },
      });

      expect(persistedProgram.status).toBe('PUBLISHED');

      // Assert: only one published version
      const publishedCount = await prisma.trainingProgramVersion.count({
        where: {
          programId,
          status: 'PUBLISHED',
        },
      });

      expect(publishedCount).toBe(1);
    } finally {
      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });

        await prisma.trainingProgram.delete({
          where: { id: programId },
        });
      }

      if (trainerId) {
        await prisma.user.delete({
          where: { id: trainerId },
        });
      }
    }
  });
});
