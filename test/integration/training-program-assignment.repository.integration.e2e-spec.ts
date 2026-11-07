import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Prisma } from '../../src/generated/prisma/client.js';

import { PrismaModule, PrismaService } from '../../src/database/index.js';
import { TrainingProgramAssignmentRepository } from '../../src/modules/training-programs/repositories/training-program-assignment.repository.js';
import { TrainerAthletesRepository } from '../../src/modules/trainer-athletes/trainer-athletes.repository.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

describe('TrainingProgramAssignmentRepository integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: TrainingProgramAssignmentRepository;
  let trainerAthletesRepository: TrainerAthletesRepository;

  beforeAll(async () => {
    useTestDatabase();

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
      providers: [
        TrainingProgramAssignmentRepository,
        TrainerAthletesRepository,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    repository = app.get(TrainingProgramAssignmentRepository);
    trainerAthletesRepository = app.get(TrainerAthletesRepository);
  }, 20_000);

  afterAll(async () => {
    await app?.close();
  }, 20_000);

  it('creates an assignment for an active trainer-athlete relationship', async () => {
    const userIds: string[] = [];
    let relationshipId: string | undefined;
    let programId: string | undefined;
    let assignmentId: string | undefined;

    try {
      const suffix = randomUUID();

      const trainer = await prisma.user.create({
        data: {
          email: `assignment-trainer-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
      });

      userIds.push(trainer.id);

      const athlete = await prisma.user.create({
        data: {
          email: `assignment-athlete-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'ATHLETE',
        },
      });

      userIds.push(athlete.id);

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId: trainer.id,
          athleteId: athlete.id,
          initiatedById: trainer.id,
          status: 'ACTIVE',
        },
      });

      relationshipId = relationship.id;

      const program = await prisma.trainingProgram.create({
        data: {
          trainerId: trainer.id,
          status: 'PUBLISHED',
          versions: {
            create: {
              version: 1,
              title: 'Assignment Integration Test',
              status: 'PUBLISHED',
              publishedAt: new Date(),
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
      const result = await repository.createAssignmentForActiveRelationship({
        trainerAthleteId: relationship.id,
        trainerId: trainer.id,
        athleteId: athlete.id,
        data: {
          version: {
            connect: { id: versionId },
          },
          trainerAthlete: {
            connect: { id: relationship.id },
          },
          athlete: {
            connect: { id: athlete.id },
          },
          assignedBy: {
            connect: { id: trainer.id },
          },
        },
      });

      expect(result).not.toBeNull();

      if (!result) {
        throw new Error('Expected assignment to be created');
      }

      assignmentId = result.id;

      expect(result).toMatchObject({
        versionId,
        trainerAthleteId: relationship.id,
        athleteId: athlete.id,
        assignedById: trainer.id,
        status: 'ACTIVE',
      });

      // Verify persisted data
      const persisted =
        await prisma.trainingProgramAssignment.findUniqueOrThrow({
          where: { id: assignmentId },
        });

      expect(persisted).toMatchObject({
        id: assignmentId,
        versionId,
        trainerAthleteId: relationship.id,
        athleteId: athlete.id,
        assignedById: trainer.id,
        status: 'ACTIVE',
      });
    } finally {
      if (assignmentId) {
        await prisma.trainingProgramAssignment.delete({
          where: { id: assignmentId },
        });
      }

      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });

        await prisma.trainingProgram.delete({
          where: { id: programId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.delete({
          where: { id: relationshipId },
        });
      }

      if (userIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: userIds } },
        });
      }
    }
  });

  it('rejects assignment creation when relationship is terminated concurrently', async () => {
    const userIds: string[] = [];
    let relationshipId: string | undefined;
    let programId: string | undefined;

    try {
      const suffix = randomUUID();

      const trainer = await prisma.user.create({
        data: {
          email: `concurrent-trainer-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
      });
      userIds.push(trainer.id);

      const athlete = await prisma.user.create({
        data: {
          email: `concurrent-athlete-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'ATHLETE',
        },
      });
      userIds.push(athlete.id);

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId: trainer.id,
          athleteId: athlete.id,
          initiatedById: trainer.id,
          status: 'ACTIVE',
        },
      });
      relationshipId = relationship.id;

      const program = await prisma.trainingProgram.create({
        data: {
          trainerId: trainer.id,
          status: 'PUBLISHED',
          versions: {
            create: {
              version: 1,
              title: 'Concurrent Assignment Test',
              status: 'PUBLISHED',
              publishedAt: new Date(),
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

      let creationPromise:
        | ReturnType<
            TrainingProgramAssignmentRepository['createAssignmentForActiveRelationship']
          >
        | undefined;

      let observedBlocking = false;

      // Transaction A holds the relationship lock.
      await prisma.$transaction(
        async (tx) => {
          const [lockedRow] = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid()::integer AS pid
          FROM "trainer_athletes"
          WHERE "id" = ${relationship.id}
          FOR UPDATE
        `;

          expect(lockedRow).toBeDefined();

          // Transaction B attempts assignment creation.
          creationPromise = repository.createAssignmentForActiveRelationship({
            trainerAthleteId: relationship.id,
            trainerId: trainer.id,
            athleteId: athlete.id,
            data: {
              version: { connect: { id: versionId } },
              trainerAthlete: {
                connect: { id: relationship.id },
              },
              athlete: { connect: { id: athlete.id } },
              assignedBy: { connect: { id: trainer.id } },
            },
          });

          // Verify B is actually blocked by A.
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

          expect(observedBlocking).toBe(true);

          // A terminates the relationship while holding the lock.
          await tx.trainerAthlete.update({
            where: { id: relationship.id },
            data: {
              status: 'TERMINATED',
              endedAt: new Date(),
              endedById: trainer.id,
            },
          });
        },
        { timeout: 15_000 },
      );

      // A has committed. B can now continue.
      const result = await creationPromise;

      expect(result).toBeNull();

      const persistedRelationship =
        await prisma.trainerAthlete.findUniqueOrThrow({
          where: { id: relationship.id },
          select: { status: true },
        });

      expect(persistedRelationship.status).toBe('TERMINATED');

      const assignmentCount = await prisma.trainingProgramAssignment.count({
        where: {
          trainerAthleteId: relationship.id,
        },
      });

      expect(assignmentCount).toBe(0);
    } finally {
      if (relationshipId) {
        await prisma.trainingProgramAssignment.deleteMany({
          where: { trainerAthleteId: relationshipId },
        });
      }

      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });

        await prisma.trainingProgram.delete({
          where: { id: programId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.delete({
          where: { id: relationshipId },
        });
      }

      if (userIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: userIds } },
        });
      }
    }
  }, 20_000);

  it('terminates an assignment created before concurrent relationship termination', async () => {
    const userIds: string[] = [];
    let relationshipId: string | undefined;
    let programId: string | undefined;

    let terminationPromise:
      | ReturnType<TrainerAthletesRepository['terminateWithExerciseCopies']>
      | undefined;

    try {
      const suffix = randomUUID();

      const trainer = await prisma.user.create({
        data: {
          email: `race-trainer-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
      });
      userIds.push(trainer.id);

      const athlete = await prisma.user.create({
        data: {
          email: `race-athlete-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'ATHLETE',
        },
      });
      userIds.push(athlete.id);

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId: trainer.id,
          athleteId: athlete.id,
          initiatedById: trainer.id,
          status: 'ACTIVE',
        },
      });
      relationshipId = relationship.id;

      const program = await prisma.trainingProgram.create({
        data: {
          trainerId: trainer.id,
          status: 'PUBLISHED',
          versions: {
            create: {
              version: 1,
              title: 'Concurrent Termination Test',
              status: 'PUBLISHED',
              publishedAt: new Date(),
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

      let observedBlocking = false;

      // Transaction A emulates assignment creation
      // while holding the relationship lock.
      await prisma.$transaction(
        async (tx) => {
          const [lockedRow] = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid()::integer AS pid
          FROM "trainer_athletes"
          WHERE "id" = ${relationship.id}
          FOR UPDATE
        `;

          expect(lockedRow).toBeDefined();

          await tx.trainingProgramAssignment.create({
            data: {
              versionId,
              trainerAthleteId: relationship.id,
              athleteId: athlete.id,
              assignedById: trainer.id,
              status: 'ACTIVE',
            },
          });

          // Transaction B attempts termination.
          terminationPromise =
            trainerAthletesRepository.terminateWithExerciseCopies({
              id: relationship.id,
              actorId: trainer.id,
              reason: 'Concurrent termination test',
            });

          // Confirm B is blocked by A.
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

          expect(observedBlocking).toBe(true);

          // Assignment creation commits after this callback.
        },
        { timeout: 15_000 },
      );

      if (!terminationPromise) {
        throw new Error('Termination was not started');
      }

      // B continues after A commits.
      const terminated = await terminationPromise;

      expect(terminated).toMatchObject({
        id: relationship.id,
        status: 'TERMINATED',
      });

      const persistedRelationship =
        await prisma.trainerAthlete.findUniqueOrThrow({
          where: { id: relationship.id },
          select: {
            status: true,
            endedById: true,
          },
        });

      expect(persistedRelationship).toEqual({
        status: 'TERMINATED',
        endedById: trainer.id,
      });

      const assignments = await prisma.trainingProgramAssignment.findMany({
        where: {
          trainerAthleteId: relationship.id,
        },
        select: {
          id: true,
          status: true,
          endedById: true,
          endReason: true,
          endedAt: true,
        },
      });

      expect(assignments).toHaveLength(1);

      expect(assignments[0]).toMatchObject({
        status: 'TERMINATED',
        endedById: trainer.id,
        endReason: 'Concurrent termination test',
      });

      expect(assignments[0]?.endedAt).toBeInstanceOf(Date);

      const activeCount = await prisma.trainingProgramAssignment.count({
        where: {
          trainerAthleteId: relationship.id,
          status: 'ACTIVE',
        },
      });

      expect(activeCount).toBe(0);
    } finally {
      // Ensure the concurrent operation has finished
      // before deleting test fixtures.
      if (terminationPromise) {
        await terminationPromise.catch(() => undefined);
      }

      if (relationshipId) {
        await prisma.trainingProgramAssignment.deleteMany({
          where: { trainerAthleteId: relationshipId },
        });
      }

      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });

        await prisma.trainingProgram.delete({
          where: { id: programId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.delete({
          where: { id: relationshipId },
        });
      }

      if (userIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: userIds } },
        });
      }
    }
  }, 30_000);

  it('keeps assignments consistent during concurrent creation and termination', async () => {
    const userIds: string[] = [];
    let relationshipId: string | undefined;
    let programId: string | undefined;

    try {
      const suffix = randomUUID();

      const trainer = await prisma.user.create({
        data: {
          email: `race-create-trainer-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
      });
      userIds.push(trainer.id);

      const athlete = await prisma.user.create({
        data: {
          email: `race-create-athlete-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'ATHLETE',
        },
      });
      userIds.push(athlete.id);

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId: trainer.id,
          athleteId: athlete.id,
          initiatedById: trainer.id,
          status: 'ACTIVE',
        },
      });
      relationshipId = relationship.id;

      const program = await prisma.trainingProgram.create({
        data: {
          trainerId: trainer.id,
          status: 'PUBLISHED',
          versions: {
            create: {
              version: 1,
              title: 'Assignment Race Test',
              status: 'PUBLISHED',
              publishedAt: new Date(),
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

      // Run both real repository methods concurrently.
      const [creation, termination] = await Promise.allSettled([
        repository.createAssignmentForActiveRelationship({
          trainerAthleteId: relationship.id,
          trainerId: trainer.id,
          athleteId: athlete.id,
          data: {
            version: { connect: { id: versionId } },
            trainerAthlete: {
              connect: { id: relationship.id },
            },
            athlete: { connect: { id: athlete.id } },
            assignedBy: { connect: { id: trainer.id } },
          },
        }),

        trainerAthletesRepository.terminateWithExerciseCopies({
          id: relationship.id,
          actorId: trainer.id,
          reason: 'Concurrent termination',
        }),
      ]);

      // Both operations must finish without errors.
      if (creation.status === 'rejected') {
        throw creation.reason;
      }

      if (termination.status === 'rejected') {
        throw termination.reason;
      }

      expect(termination.value).toMatchObject({
        id: relationship.id,
        status: 'TERMINATED',
      });

      const persistedRelationship =
        await prisma.trainerAthlete.findUniqueOrThrow({
          where: { id: relationship.id },
          select: { status: true },
        });

      expect(persistedRelationship.status).toBe('TERMINATED');

      const assignments = await prisma.trainingProgramAssignment.findMany({
        where: {
          trainerAthleteId: relationship.id,
        },
        select: {
          id: true,
          status: true,
          endedAt: true,
        },
      });

      if (creation.value === null) {
        // Termination won: assignment was not created.
        expect(assignments).toHaveLength(0);
      } else {
        // Creation won: termination must close it.
        expect(assignments).toHaveLength(1);
        expect(assignments[0]).toMatchObject({
          id: creation.value.id,
          status: 'TERMINATED',
        });
        expect(assignments[0]?.endedAt).toBeInstanceOf(Date);
      }

      // The important invariant.
      const activeCount = await prisma.trainingProgramAssignment.count({
        where: {
          trainerAthleteId: relationship.id,
          status: 'ACTIVE',
        },
      });

      expect(activeCount).toBe(0);
    } finally {
      if (relationshipId) {
        await prisma.trainingProgramAssignment.deleteMany({
          where: { trainerAthleteId: relationshipId },
        });
      }

      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });

        await prisma.trainingProgram.delete({
          where: { id: programId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.delete({
          where: { id: relationshipId },
        });
      }

      if (userIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: userIds } },
        });
      }
    }
  }, 30_000);

  it('releases the relationship lock after assignment creation fails', async () => {
    const userIds: string[] = [];
    let relationshipId: string | undefined;
    let programId: string | undefined;

    try {
      const suffix = randomUUID();

      const trainer = await prisma.user.create({
        data: {
          email: `failure-trainer-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
        select: { id: true },
      });
      userIds.push(trainer.id);

      const athlete = await prisma.user.create({
        data: {
          email: `failure-athlete-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'ATHLETE',
        },
        select: { id: true },
      });
      userIds.push(athlete.id);

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId: trainer.id,
          athleteId: athlete.id,
          initiatedById: trainer.id,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      relationshipId = relationship.id;

      const program = await prisma.trainingProgram.create({
        data: {
          trainerId: trainer.id,
          status: 'PUBLISHED',
          versions: {
            create: {
              version: 1,
              title: 'Failed Assignment Test',
              status: 'PUBLISHED',
              publishedAt: new Date(),
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

      const validVersionId = program.versions[0]!.id;

      const baseData = {
        trainerAthleteId: relationship.id,
        trainerId: trainer.id,
        athleteId: athlete.id,
      };

      // Attempt to connect a version that does not exist.
      await expect(
        repository.createAssignmentForActiveRelationship({
          ...baseData,
          data: {
            version: {
              connect: { id: randomUUID() },
            },
            trainerAthlete: {
              connect: { id: relationship.id },
            },
            athlete: {
              connect: { id: athlete.id },
            },
            assignedBy: {
              connect: { id: trainer.id },
            },
          },
        }),
      ).rejects.toThrow();

      // No assignment should have been persisted.
      const countAfterFailure = await prisma.trainingProgramAssignment.count({
        where: {
          trainerAthleteId: relationship.id,
        },
      });

      expect(countAfterFailure).toBe(0);

      // The failed transaction must not alter the relationship.
      const persistedRelationship =
        await prisma.trainerAthlete.findUniqueOrThrow({
          where: { id: relationship.id },
          select: { status: true },
        });

      expect(persistedRelationship.status).toBe('ACTIVE');

      // Retry with a valid version.
      // This requires acquiring the same relationship lock again.
      const successful = await repository.createAssignmentForActiveRelationship(
        {
          ...baseData,
          data: {
            version: {
              connect: { id: validVersionId },
            },
            trainerAthlete: {
              connect: { id: relationship.id },
            },
            athlete: {
              connect: { id: athlete.id },
            },
            assignedBy: {
              connect: { id: trainer.id },
            },
          },
        },
      );

      expect(successful).toMatchObject({
        versionId: validVersionId,
        trainerAthleteId: relationship.id,
        status: 'ACTIVE',
      });

      const countAfterRetry = await prisma.trainingProgramAssignment.count({
        where: {
          trainerAthleteId: relationship.id,
        },
      });

      expect(countAfterRetry).toBe(1);
    } finally {
      if (relationshipId) {
        await prisma.trainingProgramAssignment.deleteMany({
          where: { trainerAthleteId: relationshipId },
        });
      }

      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });

        await prisma.trainingProgram.delete({
          where: { id: programId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.delete({
          where: { id: relationshipId },
        });
      }

      if (userIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: userIds } },
        });
      }
    }
  }, 20_000);

  it('rolls back relationship and assignment termination on transaction failure', async () => {
    const userIds: string[] = [];
    let relationshipId: string | undefined;
    let programId: string | undefined;
    let assignmentId: string | undefined;
    let sourceExerciseId: string | undefined;

    try {
      const suffix = randomUUID();

      const trainer = await prisma.user.create({
        data: {
          email: `rollback-trainer-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
      });
      userIds.push(trainer.id);

      const athlete = await prisma.user.create({
        data: {
          email: `rollback-athlete-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'ATHLETE',
        },
      });
      userIds.push(athlete.id);

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId: trainer.id,
          athleteId: athlete.id,
          initiatedById: trainer.id,
          status: 'ACTIVE',
        },
      });
      relationshipId = relationship.id;

      const program = await prisma.trainingProgram.create({
        data: {
          trainerId: trainer.id,
          status: 'PUBLISHED',
          versions: {
            create: {
              version: 1,
              title: 'Rollback Assignment Test',
              status: 'PUBLISHED',
              publishedAt: new Date(),
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

      const assignment = await prisma.trainingProgramAssignment.create({
        data: {
          versionId: program.versions[0]!.id,
          trainerAthleteId: relationship.id,
          athleteId: athlete.id,
          assignedById: trainer.id,
          status: 'ACTIVE',
        },
      });
      assignmentId = assignment.id;

      const sourceExercise = await prisma.exercise.create({
        data: {
          name: 'Trainer Bench Press',
          source: 'TRAINER_CUSTOM',
          visibility: 'PRIVATE',
          exerciseType: 'STRENGTH',
          createdById: trainer.id,
        },
        select: { id: true },
      });

      sourceExerciseId = sourceExercise.id;

      // Trainer shared this exercise with the athlete.
      await prisma.exerciseAthleteAssignment.create({
        data: {
          exerciseId: sourceExercise.id,
          athleteId: athlete.id,
          assignedById: trainer.id,
        },
      });

      const injectedError = new Error('FORCED_ROLLBACK');
      let observedUpdatesInsideTransaction = false;

      // Use the real PostgreSQL transaction but inject a failure
      // after the repository's transactional callback completes.
      const injectedPrisma = {
        $transaction: (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) =>
          prisma.$transaction(async (tx) => {
            await callback(tx);

            // Verify that both updates happened inside the transaction.
            const updatedRelationship =
              await tx.trainerAthlete.findUniqueOrThrow({
                where: { id: relationship.id },
                select: { status: true },
              });

            const updatedAssignment =
              await tx.trainingProgramAssignment.findUniqueOrThrow({
                where: { id: assignment.id },
                select: { status: true },
              });

            expect(updatedRelationship.status).toBe('TERMINATED');
            expect(updatedAssignment.status).toBe('TERMINATED');

            const copiedExercise = await tx.exercise.findFirst({
              where: {
                copiedFromExerciseId: sourceExercise.id,
                createdById: athlete.id,
                source: 'ATHLETE_CUSTOM',
              },
              select: {
                id: true,
                name: true,
                visibility: true,
              },
            });

            expect(copiedExercise).toMatchObject({
              name: 'Trainer Bench Press',
              visibility: 'PRIVATE',
            });

            observedUpdatesInsideTransaction = true;

            // Force PostgreSQL to roll back every writing.
            throw injectedError;
          }),
      } as unknown as PrismaService;

      const failingRepository = new TrainerAthletesRepository(injectedPrisma);

      await expect(
        failingRepository.terminateWithExerciseCopies({
          id: relationship.id,
          actorId: trainer.id,
          reason: 'Rollback test',
        }),
      ).rejects.toBe(injectedError);

      expect(observedUpdatesInsideTransaction).toBe(true);

      // Verify the persisted state after the rollback.
      const persistedRelationship =
        await prisma.trainerAthlete.findUniqueOrThrow({
          where: { id: relationship.id },
          select: {
            status: true,
            endedAt: true,
            endedById: true,
          },
        });

      expect(persistedRelationship).toEqual({
        status: 'ACTIVE',
        endedAt: null,
        endedById: null,
      });

      const persistedAssignment =
        await prisma.trainingProgramAssignment.findUniqueOrThrow({
          where: { id: assignment.id },
          select: {
            status: true,
            endedAt: true,
            endedById: true,
          },
        });

      expect(persistedAssignment).toEqual({
        status: 'ACTIVE',
        endedAt: null,
        endedById: null,
      });

      const copiedExerciseCount = await prisma.exercise.count({
        where: {
          copiedFromExerciseId: sourceExercise.id,
          createdById: athlete.id,
          source: 'ATHLETE_CUSTOM',
        },
      });

      expect(copiedExerciseCount).toBe(0);

      const exerciseAssignment =
        await prisma.exerciseAthleteAssignment.findUniqueOrThrow({
          where: {
            exerciseId_athleteId: {
              exerciseId: sourceExercise.id,
              athleteId: athlete.id,
            },
          },
          select: {
            revokedAt: true,
          },
        });

      expect(exerciseAssignment.revokedAt).toBeNull();
    } finally {
      if (assignmentId) {
        await prisma.trainingProgramAssignment.deleteMany({
          where: { id: assignmentId },
        });
      }

      if (programId) {
        await prisma.trainingProgramVersion.deleteMany({
          where: { programId },
        });

        await prisma.trainingProgram.deleteMany({
          where: { id: programId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: relationshipId },
        });
      }

      if (sourceExerciseId) {
        await prisma.exercise.deleteMany({
          where: {
            copiedFromExerciseId: sourceExerciseId,
          },
        });

        await prisma.exerciseAthleteAssignment.deleteMany({
          where: {
            exerciseId: sourceExerciseId,
          },
        });

        await prisma.exercise.deleteMany({
          where: {
            id: sourceExerciseId,
          },
        });
      }

      if (userIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: userIds } },
        });
      }
    }
  }, 20_000);

  it('does not duplicate exercise copies on repeated relationship termination', async () => {
    const userIds: string[] = [];
    let relationshipId: string | undefined;
    let sourceExerciseId: string | undefined;

    try {
      const suffix = randomUUID();

      const trainer = await prisma.user.create({
        data: {
          email: `repeat-trainer-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
      });
      userIds.push(trainer.id);

      const athlete = await prisma.user.create({
        data: {
          email: `repeat-athlete-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'ATHLETE',
        },
      });
      userIds.push(athlete.id);

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId: trainer.id,
          athleteId: athlete.id,
          initiatedById: trainer.id,
          status: 'ACTIVE',
        },
      });
      relationshipId = relationship.id;

      const exercise = await prisma.exercise.create({
        data: {
          name: 'Trainer Squat',
          source: 'TRAINER_CUSTOM',
          visibility: 'PRIVATE',
          exerciseType: 'STRENGTH',
          createdById: trainer.id,
        },
      });
      sourceExerciseId = exercise.id;

      await prisma.exerciseAthleteAssignment.create({
        data: {
          exerciseId: exercise.id,
          athleteId: athlete.id,
          assignedById: trainer.id,
        },
      });

      // First termination
      const firstResult =
        await trainerAthletesRepository.terminateWithExerciseCopies({
          id: relationship.id,
          actorId: trainer.id,
          reason: 'First termination',
        });

      expect(firstResult).toMatchObject({
        id: relationship.id,
        status: 'TERMINATED',
        endReason: 'First termination',
      });

      const firstCopies = await prisma.exercise.findMany({
        where: {
          copiedFromExerciseId: exercise.id,
          createdById: athlete.id,
        },
        select: {
          id: true,
          source: true,
          visibility: true,
        },
      });

      expect(firstCopies).toHaveLength(1);
      expect(firstCopies[0]).toMatchObject({
        source: 'ATHLETE_CUSTOM',
        visibility: 'PRIVATE',
      });

      const firstEndedAt = firstResult?.endedAt;
      expect(firstEndedAt).toBeInstanceOf(Date);

      // Second termination
      const secondResult =
        await trainerAthletesRepository.terminateWithExerciseCopies({
          id: relationship.id,
          actorId: trainer.id,
          reason: 'Second termination',
        });

      expect(secondResult).toBeNull();

      // No additional exercise copies
      const copiesAfterRetry = await prisma.exercise.findMany({
        where: {
          copiedFromExerciseId: exercise.id,
          createdById: athlete.id,
        },
        select: { id: true },
      });

      expect(copiesAfterRetry).toHaveLength(1);
      expect(copiesAfterRetry[0]?.id).toBe(firstCopies[0]?.id);

      // Original termination metadata remains unchanged
      const persistedRelationship =
        await prisma.trainerAthlete.findUniqueOrThrow({
          where: { id: relationship.id },
          select: {
            status: true,
            endedAt: true,
            endReason: true,
          },
        });

      expect(persistedRelationship).toEqual({
        status: 'TERMINATED',
        endedAt: firstEndedAt,
        endReason: 'First termination',
      });
    } finally {
      if (sourceExerciseId) {
        await prisma.exerciseAthleteAssignment.deleteMany({
          where: { exerciseId: sourceExerciseId },
        });

        await prisma.exercise.deleteMany({
          where: { copiedFromExerciseId: sourceExerciseId },
        });

        await prisma.exercise.deleteMany({
          where: { id: sourceExerciseId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: relationshipId },
        });
      }

      if (userIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: userIds } },
        });
      }
    }
  }, 20_000);

  it('reuses an existing exercise copy after renewed collaboration', async () => {
    const userIds: string[] = [];
    const relationshipIds: string[] = [];
    let sourceExerciseId: string | undefined;

    try {
      const suffix = randomUUID();

      const trainer = await prisma.user.create({
        data: {
          email: `renewal-trainer-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'TRAINER',
        },
        select: { id: true },
      });
      userIds.push(trainer.id);

      const athlete = await prisma.user.create({
        data: {
          email: `renewal-athlete-${suffix}@example.com`,
          passwordHash: 'test-password-hash',
          role: 'ATHLETE',
        },
        select: { id: true },
      });
      userIds.push(athlete.id);

      const exercise = await prisma.exercise.create({
        data: {
          name: 'Trainer Deadlift',
          source: 'TRAINER_CUSTOM',
          visibility: 'PRIVATE',
          exerciseType: 'STRENGTH',
          createdById: trainer.id,
        },
        select: { id: true },
      });
      sourceExerciseId = exercise.id;

      // First collaboration
      const firstRelationship = await prisma.trainerAthlete.create({
        data: {
          trainerId: trainer.id,
          athleteId: athlete.id,
          initiatedById: trainer.id,
          status: 'ACTIVE',
        },
      });
      relationshipIds.push(firstRelationship.id);

      // Trainer shares the exercise.
      await prisma.exerciseAthleteAssignment.create({
        data: {
          exerciseId: exercise.id,
          athleteId: athlete.id,
          assignedById: trainer.id,
        },
      });

      const firstTermination =
        await trainerAthletesRepository.terminateWithExerciseCopies({
          id: firstRelationship.id,
          actorId: trainer.id,
          reason: 'First collaboration ended',
        });

      expect(firstTermination?.status).toBe('TERMINATED');

      const copiesAfterFirstTermination = await prisma.exercise.findMany({
        where: {
          copiedFromExerciseId: exercise.id,
          createdById: athlete.id,
        },
        select: {
          id: true,
          source: true,
          visibility: true,
        },
      });

      expect(copiesAfterFirstTermination).toHaveLength(1);

      const originalCopyId = copiesAfterFirstTermination[0]!.id;

      expect(copiesAfterFirstTermination[0]).toMatchObject({
        source: 'ATHLETE_CUSTOM',
        visibility: 'PRIVATE',
      });

      // Second collaboration between the same users.
      const secondRelationship = await prisma.trainerAthlete.create({
        data: {
          trainerId: trainer.id,
          athleteId: athlete.id,
          initiatedById: athlete.id,
          status: 'ACTIVE',
        },
      });
      relationshipIds.push(secondRelationship.id);

      // Restore access for the second collaboration.
      // The exercise-athlete pair has a unique constraint,
      // so we reuse the existing share record.
      await prisma.exerciseAthleteAssignment.update({
        where: {
          exerciseId_athleteId: {
            exerciseId: exercise.id,
            athleteId: athlete.id,
          },
        },
        data: {
          revokedAt: null,
          assignedAt: secondRelationship.createdAt,
        },
      });

      const secondTermination =
        await trainerAthletesRepository.terminateWithExerciseCopies({
          id: secondRelationship.id,
          actorId: athlete.id,
          reason: 'Second collaboration ended',
        });

      expect(secondTermination?.status).toBe('TERMINATED');

      // The existing personal copy must be reused.
      const copiesAfterSecondTermination = await prisma.exercise.findMany({
        where: {
          copiedFromExerciseId: exercise.id,
          createdById: athlete.id,
        },
        select: {
          id: true,
          source: true,
          visibility: true,
        },
      });

      expect(copiesAfterSecondTermination).toHaveLength(1);
      expect(copiesAfterSecondTermination[0]?.id).toBe(originalCopyId);

      // Verify both relationships were terminated.
      const relationships = await prisma.trainerAthlete.findMany({
        where: {
          id: { in: relationshipIds },
        },
        select: {
          id: true,
          status: true,
        },
      });

      expect(relationships).toHaveLength(2);

      expect(relationships.every((item) => item.status === 'TERMINATED')).toBe(
        true,
      );

      // Access to the trainer's original exercise is revoked.
      const sharedExercise =
        await prisma.exerciseAthleteAssignment.findUniqueOrThrow({
          where: {
            exerciseId_athleteId: {
              exerciseId: exercise.id,
              athleteId: athlete.id,
            },
          },
          select: { revokedAt: true },
        });

      expect(sharedExercise.revokedAt).toBeInstanceOf(Date);
    } finally {
      if (sourceExerciseId) {
        await prisma.exerciseAthleteAssignment.deleteMany({
          where: { exerciseId: sourceExerciseId },
        });

        await prisma.exercise.deleteMany({
          where: {
            copiedFromExerciseId: sourceExerciseId,
          },
        });

        await prisma.exercise.deleteMany({
          where: { id: sourceExerciseId },
        });
      }

      if (relationshipIds.length > 0) {
        await prisma.trainerAthlete.deleteMany({
          where: {
            id: { in: relationshipIds },
          },
        });
      }

      if (userIds.length > 0) {
        await prisma.user.deleteMany({
          where: {
            id: { in: userIds },
          },
        });
      }
    }
  }, 20_000);
});
