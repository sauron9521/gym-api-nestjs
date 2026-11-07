import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { PrismaModule, PrismaService } from '../../src/database/index.js';
import { TrainingProgramVersionRepository } from '../../src/modules/training-programs/repositories/training-program-version.repository.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

describe('TrainingProgramVersionRepository integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: TrainingProgramVersionRepository;

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
  }, 20_000);

  afterAll(async () => {
    await app?.close();
  }, 20_000);

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
      expect(draft.workouts).toHaveLength(1);

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
      expect(copiedWorkout.exercises).toHaveLength(1);

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
      expect(copiedExercise.sets).toHaveLength(1);

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

      // Assert: changes are persisted in PostgreSQL
      const persistedDraft = await repository.findVersionById(draft.id);

      expect(persistedDraft).toEqual(draft);

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
      const results = await Promise.allSettled([
        repository.createDraftFromLatestPublished(programId),
        repository.createDraftFromLatestPublished(programId),
      ]);

      // Exactly one request should create a draft
      const created = results.flatMap((result) =>
        result.status === 'fulfilled' && result.value !== null
          ? [result.value]
          : [],
      );

      expect(created).toHaveLength(1);

      expect(created[0]).toMatchObject({
        programId,
        version: 2,
        status: 'DRAFT',
      });

      // The second request can return null if it sees
      // the existing draft, or fail with a unique violation.
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toMatchObject({
            code: 'P2002',
          });
        }
      }

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
});
