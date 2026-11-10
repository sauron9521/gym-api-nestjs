import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { StandardSchemaValidationPipe, ValidationPipe } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';
import { PasswordHasher } from '@nestjs/authentication';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';

import request from 'supertest';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/database/index.js';
import { WorkoutsRepository } from '../src/modules/workouts/repositories/workouts.repository.js';
import { useTestDatabase } from './utility/test-db-helper.js';

describe('Workouts (HTTP + PostgreSQL)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  let passwordHasher: PasswordHasher;

  let trainerId: string;
  let programId: string;
  let programWorkoutId: string;
  let anotherVersionWorkoutId: string;
  let programAssignmentId: string;
  let anotherVersionId: string;

  const trainerAthleteIds: string[] = [];
  const assignmentIds: string[] = [];
  const programIds: string[] = [];

  let ownerId: string;

  let ownerCookie: string;
  let otherAthleteCookie: string;

  let globalExerciseId: string;
  let privateExerciseId: string;

  let createdWorkoutId: string;
  let firstSetId: string;
  let secondSetId: string;

  const userIds: string[] = [];
  const exerciseIds: string[] = [];

  const password = 'StrongPassword123!';

  const ownerEmail = `workout-owner-${randomUUID()}@example.com`;
  const otherEmail = `workout-other-${randomUUID()}@example.com`;

  const globalSlug = `e2e-workout-${randomUUID()}`;

  function extractSessionCookie(header: string | string[] | undefined): string {
    const cookies = Array.isArray(header) ? header : header ? [header] : [];

    const cookie = cookies
      .map((value) => value.split(';', 1)[0] ?? '')
      .find((value) => value.startsWith('__Host-sid='));

    if (!cookie) {
      throw new Error('Session cookie was not set.');
    }

    return cookie;
  }

  async function login(email: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({
        email,
        password,
      });

    expect(response.status).toBe(200);

    return extractSessionCookie(response.headers['set-cookie']);
  }

  function workoutPayload(title = 'E2E Upper Body') {
    return {
      title,
      notes: 'E2E workout notes',
      exercises: [
        {
          exerciseId: globalExerciseId,
          notes: 'Bench press',
          sets: [
            {
              setType: 'WORKING',
              plannedReps: 10,
              plannedWeightKg: 60,
              restSeconds: 90,
            },
            {
              setType: 'WORKING',
              plannedReps: 8,
              plannedWeightKg: 60,
              restSeconds: 90,
            },
          ],
        },
      ],
    };
  }

  async function createWorkout(title: string) {
    const response = await request(app!.getHttpServer())
      .post('/workouts')
      .set('Cookie', ownerCookie)
      .send(workoutPayload(title));

    expect(response.status).toBe(201);

    return response.body as {
      id: string;
      status: string;
    };
  }

  beforeAll(async () => {
    // Never allow these tests to connect to the development database.
    useTestDatabase();

    const moduleRef = await Test.createTestingModule({
      imports: [await ConfigModule.forRoot({ isGlobal: true }), AppModule],
    })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
      new StandardSchemaValidationPipe(),
    );

    await app.init();

    prisma = app.get(PrismaService);
    passwordHasher = app.get(PasswordHasher);

    const passwordHash = await passwordHasher.hash(password);

    const owner = await prisma.user.create({
      data: {
        email: ownerEmail,
        passwordHash,
        role: 'ATHLETE',
      },
      select: { id: true },
    });

    ownerId = owner.id;
    userIds.push(owner.id);

    const otherAthlete = await prisma.user.create({
      data: {
        email: otherEmail,
        passwordHash,
        role: 'ATHLETE',
      },
      select: { id: true },
    });

    const trainer = await prisma.user.create({
      data: {
        email: `workout-trainer-${randomUUID()}@example.com`,
        passwordHash,
        role: 'TRAINER',
      },
      select: { id: true },
    });

    trainerId = trainer.id;
    userIds.push(trainer.id);

    userIds.push(otherAthlete.id);

    // Create a global exercise.
    const globalExercise = await prisma.exercise.create({
      data: {
        slug: globalSlug,
        name: 'E2E Workout Bench Press',
        source: 'GLOBAL',
        exerciseType: 'STRENGTH',
      },
      select: { id: true },
    });

    const trainerAthlete = await prisma.trainerAthlete.create({
      data: {
        trainerId,
        athleteId: ownerId,
        initiatedById: trainerId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    trainerAthleteIds.push(trainerAthlete.id);

    const program = await prisma.trainingProgram.create({
      data: {
        trainerId,
        status: 'PUBLISHED',
      },
      select: { id: true },
    });

    programId = program.id;
    programIds.push(program.id);

    const version = await prisma.trainingProgramVersion.create({
      data: {
        programId,
        version: 1,
        title: 'E2E Training Program',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
      select: { id: true },
    });

    const anotherVersion = await prisma.trainingProgramVersion.create({
      data: {
        programId,
        version: 2,
        title: 'E2E Another Version',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
      select: { id: true },
    });

    anotherVersionId = anotherVersion.id;

    const programWorkout = await prisma.trainingProgramWorkout.create({
      data: {
        versionId: version.id,
        weekNumber: 1,
        dayNumber: 1,
        title: 'E2E Program Workout',
        notes: 'Created from an assigned program',
      },
      select: { id: true },
    });

    programWorkoutId = programWorkout.id;

    const anotherProgramWorkout = await prisma.trainingProgramWorkout.create({
      data: {
        versionId: anotherVersion.id,
        weekNumber: 1,
        dayNumber: 1,
        title: 'E2E Another Version Workout',
      },
      select: { id: true },
    });

    anotherVersionWorkoutId = anotherProgramWorkout.id;

    const programExercise = await prisma.trainingProgramExercise.create({
      data: {
        workoutId: programWorkoutId,
        exerciseId: globalExercise.id,
        exerciseNameSnapshot: 'Program Bench Press Snapshot',
        exerciseTypeSnapshot: 'STRENGTH',
        sortOrder: 0,
        notes: 'Program exercise notes',
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
      },
    });

    const assignment = await prisma.trainingProgramAssignment.create({
      data: {
        versionId: version.id,
        trainerAthleteId: trainerAthlete.id,
        athleteId: ownerId,
        assignedById: trainerId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    programAssignmentId = assignment.id;
    assignmentIds.push(assignment.id);

    globalExerciseId = globalExercise.id;
    exerciseIds.push(globalExercise.id);

    // Create another athlete's private exercise.
    const privateExercise = await prisma.exercise.create({
      data: {
        name: 'E2E Other Athlete Private Exercise',
        source: 'ATHLETE_CUSTOM',
        visibility: 'PRIVATE',
        exerciseType: 'STRENGTH',
        createdBy: {
          connect: { id: otherAthlete.id },
        },
      },
      select: { id: true },
    });

    privateExerciseId = privateExercise.id;
    exerciseIds.push(privateExercise.id);

    ownerCookie = await login(ownerEmail);
    otherAthleteCookie = await login(otherEmail);
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma) {
        // Delete workouts first because they reference exercises and users.
        if (userIds.length > 0) {
          await prisma.workout.deleteMany({
            where: {
              OR: [
                { athleteId: { in: userIds } },
                { createdById: { in: userIds } },
              ],
            },
          });
        }

        if (assignmentIds.length > 0) {
          await prisma.trainingProgramAssignment.deleteMany({
            where: {
              id: { in: assignmentIds },
            },
          });
        }

        if (trainerAthleteIds.length > 0) {
          await prisma.trainerAthlete.deleteMany({
            where: {
              id: { in: trainerAthleteIds },
            },
          });
        }

        if (programIds.length > 0) {
          await prisma.trainingProgramVersion.deleteMany({
            where: {
              programId: { in: programIds },
            },
          });

          await prisma.trainingProgram.deleteMany({
            where: {
              id: { in: programIds },
            },
          });
        }

        if (exerciseIds.length > 0) {
          await prisma.exercise.deleteMany({
            where: {
              id: { in: exerciseIds },
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
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('should return 409 for a concurrent duplicate program assignment', async () => {
    const trainer = await prisma.user.findUniqueOrThrow({
      where: { id: trainerId },
      select: { email: true },
    });

    const trainerCookie = await login(trainer.email);
    const relationshipId = trainerAthleteIds[0]!;

    // Create an isolated published program for this test.
    const program = await prisma.trainingProgram.create({
      data: {
        trainerId,
        status: 'PUBLISHED',
        versions: {
          create: {
            version: 1,
            title: 'Concurrent HTTP Assignment',
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

    const versionId = program.versions[0]!.id;

    try {
      const endpoint =
        `/training-programs/${program.id}` +
        `/versions/${versionId}/assignments`;

      const sendAssignment = () =>
        request(app!.getHttpServer())
          .post(endpoint)
          .set('Cookie', trainerCookie)
          .send({
            trainerAthleteId: relationshipId,
          });

      // Two concurrent HTTP requests.
      const [first, second] = await Promise.all([
        sendAssignment(),
        sendAssignment(),
      ]);

      // Exactly one must succeed.
      const statuses = [first.status, second.status].sort((a, b) => a - b);

      expect(statuses).toEqual([201, 409]);

      const successful = first.status === 201 ? first : second;
      const conflict = first.status === 409 ? first : second;

      expect(successful.body).toMatchObject({
        versionId,
        trainerAthleteId: relationshipId,
        athleteId: ownerId,
        assignedById: trainerId,
        status: 'ACTIVE',
      });

      // Prisma P2002 must be converted to HTTP 409.
      expect(conflict.body.message).toBe(
        'This program assignment already exists.',
      );

      // Verify the actual PostgreSQL state.
      const assignments = await prisma.trainingProgramAssignment.findMany({
        where: {
          versionId,
          athleteId: ownerId,
        },
        select: {
          id: true,
          status: true,
        },
      });

      expect(assignments).toHaveLength(1);

      expect(assignments[0]).toEqual({
        id: successful.body.id,
        status: 'ACTIVE',
      });
    } finally {
      await prisma.trainingProgramAssignment.deleteMany({
        where: { versionId },
      });

      await prisma.trainingProgramVersion.deleteMany({
        where: { programId: program.id },
      });

      await prisma.trainingProgram.delete({
        where: { id: program.id },
      });
    }
  }, 20_000);

  it('hides athlete personal data from former trainers', async () => {
    const trainer = await prisma.user.findUniqueOrThrow({
      where: { id: trainerId },
      select: { email: true },
    });

    const trainerCookie = await login(trainer.email);

    const original = await prisma.trainingProgramAssignment.findUniqueOrThrow({
      where: { id: programAssignmentId },
      select: { versionId: true },
    });

    let athleteId: string | undefined;
    let relationshipId: string | undefined;
    let renewedRelationshipId: string | undefined;
    let assignmentId: string | undefined;

    try {
      const athlete = await prisma.user.create({
        data: {
          email: `historical-athlete-${randomUUID()}@example.com`,
          passwordHash: await passwordHasher.hash(password),
          role: 'ATHLETE',
        },
        select: { id: true, email: true },
      });
      athleteId = athlete.id;

      const athleteCookie = await login(athlete.email);

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId,
          athleteId: athlete.id,
          initiatedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      relationshipId = relationship.id;

      const assignment = await prisma.trainingProgramAssignment.create({
        data: {
          versionId: original.versionId,
          trainerAthleteId: relationship.id,
          athleteId: athlete.id,
          assignedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      assignmentId = assignment.id;

      const detailsUrl = `/training-programs/assignments/${assignment.id}`;

      // The trainer can access the active assignment.
      const before = await request(app!.getHttpServer())
        .get(detailsUrl)
        .set('Cookie', trainerCookie);

      expect(before.status).toBe(200);

      // End the relationship through the real HTTP endpoint.
      const termination = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${relationship.id}/terminate`)
        .set('Cookie', trainerCookie)
        .send({ reason: 'Historical access test' });

      expect(termination.status).toBe(200);
      expect(termination.body.status).toBe('TERMINATED');

      // 1. Verify the actual database state first.
      const persistedAssignment =
        await prisma.trainingProgramAssignment.findUniqueOrThrow({
          where: { id: assignment.id },
          select: {
            id: true,
            status: true,
            trainerAthleteId: true,
          },
        });

      expect(persistedAssignment).toEqual({
        id: assignment.id,
        status: 'TERMINATED',
        trainerAthleteId: relationship.id,
      });

      // 2. Read the SAME assignment as both participants.
      const [trainerResponse, athleteResponse] = await Promise.all([
        request(app!.getHttpServer())
          .get(detailsUrl)
          .set('Cookie', trainerCookie),

        request(app!.getHttpServer())
          .get(detailsUrl)
          .set('Cookie', athleteCookie),
      ]);

      expect(trainerResponse.status).toBe(200);
      expect(athleteResponse.status).toBe(200);

      // Former trainer requests the assignment list.
      const listResponse = await request(app!.getHttpServer())
        .get('/training-programs/assignments')
        .set('Cookie', trainerCookie)
        .query({
          page: 1,
          limit: 100,
        });

      expect(listResponse.status).toBe(200);

      type AssignmentListItem = {
        id: string;
        status: string;
        athlete?: {
          id: string;
          email?: string;
        };
        trainerAthlete?: {
          status: string;
        };
        workouts?: unknown[];
      };

      const historicalAssignment = (
        listResponse.body.data as AssignmentListItem[]
      ).find((item) => item.id === assignment.id);

      // Historical assignment must remain accessible.
      expect(historicalAssignment).toBeDefined();

      expect(historicalAssignment).toMatchObject({
        id: assignment.id,
        status: 'TERMINATED',
      });

      // But sensitive data must not be returned.
      expect(historicalAssignment?.athlete?.email).toBeUndefined();

      expect(historicalAssignment).not.toHaveProperty('workouts');

      // 3. Both participants must see the same lifecycle status.
      expect(trainerResponse.body).toMatchObject({
        id: assignment.id,
        status: 'TERMINATED',
      });

      expect(athleteResponse.body).toMatchObject({
        id: assignment.id,
        status: 'TERMINATED',
        athlete: {
          id: athlete.id,
          email: athlete.email,
        },
      });

      // 4. Privacy checks — expected to fail for now.
      expect(trainerResponse.body.athlete?.email).toBeUndefined();
      expect(trainerResponse.body).not.toHaveProperty('workouts');

      // Find the existing ACTIVE assignment of the trainer.
      const activeAssignment = (
        listResponse.body.data as AssignmentListItem[]
      ).find((item) => item.id === programAssignmentId);

      expect(activeAssignment).toBeDefined();

      expect(activeAssignment).toMatchObject({
        id: programAssignmentId,
        status: 'ACTIVE',
        athlete: {
          id: ownerId,
          email: ownerEmail,
        },
        trainerAthlete: {
          status: 'ACTIVE',
        },
      });

      // Active collaboration retains workout data.
      expect(activeAssignment).toHaveProperty('workouts');
      expect(Array.isArray(activeAssignment?.workouts)).toBe(true);

      // The historical assignment remains visible.
      expect(historicalAssignment).toMatchObject({
        id: assignment.id,
        status: 'TERMINATED',
        athlete: {
          id: athlete.id,
        },
        trainerAthlete: {
          status: 'TERMINATED',
        },
      });

      // But historical data is restricted.
      expect(historicalAssignment?.athlete?.email).toBeUndefined();
      expect(historicalAssignment).not.toHaveProperty('workouts');

      // Both assignments must appear exactly at once.
      const returnedIds = (listResponse.body.data as AssignmentListItem[]).map(
        (item) => item.id,
      );

      expect(
        returnedIds.filter((id) => id === programAssignmentId),
      ).toHaveLength(1);

      expect(returnedIds.filter((id) => id === assignment.id)).toHaveLength(1);

      // Verify pagination preserves the original order and metadata.
      const [firstPage, secondPage] = await Promise.all([
        request(app!.getHttpServer())
          .get('/training-programs/assignments')
          .set('Cookie', trainerCookie)
          .query({ page: 1, limit: 1 }),

        request(app!.getHttpServer())
          .get('/training-programs/assignments')
          .set('Cookie', trainerCookie)
          .query({ page: 2, limit: 1 }),
      ]);

      expect(firstPage.status).toBe(200);
      expect(secondPage.status).toBe(200);

      // Both test assignments must be present in the original list.
      expect(listResponse.body.data.length).toBeGreaterThanOrEqual(2);

      const expectedTotal = listResponse.body.meta.total;

      expect(firstPage.body.meta).toMatchObject({
        total: expectedTotal,
        skip: 0,
        take: 1,
        totalPages: expectedTotal,
      });

      expect(secondPage.body.meta).toMatchObject({
        total: expectedTotal,
        skip: 1,
        take: 1,
        totalPages: expectedTotal,
      });

      // Paginated results must preserve the original ordering.
      expect(firstPage.body.data).toHaveLength(1);
      expect(secondPage.body.data).toHaveLength(1);

      expect(firstPage.body.data[0].id).toBe(listResponse.body.data[0].id);

      expect(secondPage.body.data[0].id).toBe(listResponse.body.data[1].id);

      // Pages must not contain duplicate assignments.
      expect(firstPage.body.data[0].id).not.toBe(secondPage.body.data[0].id);

      // Privacy rules must also apply to paginated results.
      for (const response of [firstPage, secondPage]) {
        for (const item of response.body.data as AssignmentListItem[]) {
          if (item.trainerAthlete?.status !== 'ACTIVE') {
            expect(item.athlete?.email).toBeUndefined();
            expect(item).not.toHaveProperty('workouts');
          }
        }
      }

      // Document the CURRENT access policy.
      const after = await request(app!.getHttpServer())
        .get(detailsUrl)
        .set('Cookie', trainerCookie);

      expect(after.status).toBe(200);
      expect(after.status).toBe(200);

      expect(after.body).toMatchObject({
        id: assignment.id,
        status: 'TERMINATED',
        versionId: original.versionId,
        trainerAthlete: {
          status: 'TERMINATED',
        },
      });

      // Former trainer must not receive athlete contact details.
      expect(after.body.athlete?.email).toBeUndefined();

      // Individual workout data must not be exposed.
      expect(after.body).not.toHaveProperty('workouts');

      // Starting a new relationship with the same trainer must NOT restore
      // access to the terminated assignment's historical private fields.
      const renewed = await prisma.trainerAthlete.create({
        data: {
          trainerId,
          athleteId: athlete.id,
          initiatedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      renewedRelationshipId = renewed.id;

      const [renewedDetails, renewedList] = await Promise.all([
        request(app!.getHttpServer())
          .get(detailsUrl)
          .set('Cookie', trainerCookie),
        request(app!.getHttpServer())
          .get('/training-programs/assignments')
          .set('Cookie', trainerCookie)
          .query({ page: 1, limit: 100 }),
      ]);

      expect(renewedDetails.status).toBe(200);
      expect(renewedList.status).toBe(200);
      const previousAssignment = (renewedList.body.data as AssignmentListItem[])
        .find((item) => item.id === assignment.id);
      expect(previousAssignment).toBeDefined();

      for (const historical of [renewedDetails.body, previousAssignment]) {
        expect(historical).toMatchObject({
          id: assignment.id,
          status: 'TERMINATED',
          trainerAthlete: { status: 'TERMINATED' },
        });
        expect(historical).not.toHaveProperty('workouts');
        expect(historical.athlete).not.toHaveProperty('email');
        expect(JSON.stringify(historical)).not.toContain(athlete.email);
      }
    } finally {
      if (assignmentId) {
        await prisma.trainingProgramAssignment.deleteMany({
          where: { id: assignmentId },
        });
      }

      if (renewedRelationshipId) {
        await prisma.trainerAthlete.deleteMany({ where: { id: renewedRelationshipId } });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: relationshipId },
        });
      }

      if (athleteId) {
        await prisma.user.deleteMany({
          where: { id: athleteId },
        });
      }
    }
  }, 20_000);

  it('should hide active and historical assignments from an unrelated trainer', async () => {
    const createdUserIds: string[] = [];
    const createdRelationshipIds: string[] = [];
    const createdAssignmentIds: string[] = [];

    try {
      const passwordHash = await passwordHasher.hash(password);

      // Create an unrelated trainer.
      const outsider = await prisma.user.create({
        data: {
          email: `outsider-trainer-${randomUUID()}@example.com`,
          passwordHash,
          role: 'TRAINER',
        },
        select: { id: true, email: true },
      });

      createdUserIds.push(outsider.id);

      const version = await prisma.trainingProgramAssignment.findUniqueOrThrow({
        where: { id: programAssignmentId },
        select: { versionId: true },
      });

      const assignmentIdsToCheck: string[] = [];

      // Create two isolated assignments for the original trainer.
      for (const status of ['ACTIVE', 'TERMINATED'] as const) {
        const athlete = await prisma.user.create({
          data: {
            email: `access-athlete-${randomUUID()}@example.com`,
            passwordHash,
            role: 'ATHLETE',
          },
          select: { id: true },
        });

        createdUserIds.push(athlete.id);

        const relationship = await prisma.trainerAthlete.create({
          data: {
            trainerId,
            athleteId: athlete.id,
            initiatedById: trainerId,
            status,
          },
          select: { id: true },
        });

        createdRelationshipIds.push(relationship.id);

        const assignment = await prisma.trainingProgramAssignment.create({
          data: {
            versionId: version.versionId,
            trainerAthleteId: relationship.id,
            athleteId: athlete.id,
            assignedById: trainerId,
            status,
          },
          select: { id: true },
        });

        createdAssignmentIds.push(assignment.id);
        assignmentIdsToCheck.push(assignment.id);
      }

      const outsiderCookie = await login(outsider.email);

      // 1. The outsider must not see another trainer's list.
      const listResponse = await request(app!.getHttpServer())
        .get('/training-programs/assignments')
        .set('Cookie', outsiderCookie)
        .query({ page: 1, limit: 100 });

      expect(listResponse.status).toBe(200);
      expect(listResponse.body.data).toEqual([]);
      expect(listResponse.body.meta.total).toBe(0);

      // 2. Knowing assignment IDs must not grant access.
      for (const assignmentId of assignmentIdsToCheck) {
        const detailsResponse = await request(app!.getHttpServer())
          .get(`/training-programs/assignments/${assignmentId}`)
          .set('Cookie', outsiderCookie);

        expect(detailsResponse.status).toBe(404);
      }

      // 3. The outsider cannot cancel another trainer's assignment.
      const cancelResponse = await request(app!.getHttpServer())
        .post(
          `/training-programs/assignments/${assignmentIdsToCheck[0]}/cancel`,
        )
        .set('Cookie', outsiderCookie)
        .send({ reason: 'Unauthorized cancellation' });

      expect(cancelResponse.status).toBe(404);

      // The unauthorized request must not mutate the assignment.
      const persisted =
        await prisma.trainingProgramAssignment.findUniqueOrThrow({
          where: { id: assignmentIdsToCheck[0] },
          select: { status: true },
        });

      expect(persisted.status).toBe('ACTIVE');
    } finally {
      await prisma.trainingProgramAssignment.deleteMany({
        where: { id: { in: createdAssignmentIds } },
      });

      await prisma.trainerAthlete.deleteMany({
        where: { id: { in: createdRelationshipIds } },
      });

      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
  }, 20_000);

  it('should allow only one concurrent assignment cancellation', async () => {
    let athleteId: string | undefined;
    let relationshipId: string | undefined;
    let assignmentId: string | undefined;

    try {
      const trainer = await prisma.user.findUniqueOrThrow({
        where: { id: trainerId },
        select: { email: true },
      });

      const trainerCookie = await login(trainer.email);

      // Isolated athlete to avoid changing shared fixtures.
      const athlete = await prisma.user.create({
        data: {
          email: `cancel-race-${randomUUID()}@example.com`,
          passwordHash: await passwordHasher.hash(password),
          role: 'ATHLETE',
        },
        select: { id: true },
      });

      athleteId = athlete.id;

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId,
          athleteId: athlete.id,
          initiatedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      relationshipId = relationship.id;

      const original = await prisma.trainingProgramAssignment.findUniqueOrThrow(
        {
          where: { id: programAssignmentId },
          select: { versionId: true },
        },
      );

      const assignment = await prisma.trainingProgramAssignment.create({
        data: {
          versionId: original.versionId,
          trainerAthleteId: relationship.id,
          athleteId: athlete.id,
          assignedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      assignmentId = assignment.id;

      const endpoint = `/training-programs/assignments/${assignment.id}/cancel`;

      // Two real HTTP requests competing for the same assignment.
      const [first, second] = await Promise.all([
        request(app!.getHttpServer())
          .post(endpoint)
          .set('Cookie', trainerCookie)
          .send({ reason: 'Cancellation A' }),

        request(app!.getHttpServer())
          .post(endpoint)
          .set('Cookie', trainerCookie)
          .send({ reason: 'Cancellation B' }),
      ]);

      // Exactly one request succeeds.
      expect([first.status, second.status].sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);

      const successful = [first, second].find(
        (response) => response.status === 200,
      );

      expect(successful?.body).toMatchObject({
        id: assignment.id,
        status: 'CANCELLED',
      });

      // Verify persisted state, not only the HTTP responses.
      const persisted =
        await prisma.trainingProgramAssignment.findUniqueOrThrow({
          where: { id: assignment.id },
          select: {
            status: true,
            endedAt: true,
            endedById: true,
            endReason: true,
          },
        });

      expect(persisted.status).toBe('CANCELLED');
      expect(persisted.endedAt).not.toBeNull();
      expect(persisted.endedById).toBe(trainerId);

      expect(['Cancellation A', 'Cancellation B']).toContain(
        persisted.endReason,
      );

      // Cancelling a program must not terminate collaboration.
      const persistedRelationship =
        await prisma.trainerAthlete.findUniqueOrThrow({
          where: { id: relationship.id },
          select: { status: true },
        });

      expect(persistedRelationship.status).toBe('ACTIVE');
    } finally {
      if (assignmentId) {
        await prisma.trainingProgramAssignment.deleteMany({
          where: { id: assignmentId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: relationshipId },
        });
      }

      if (athleteId) {
        await prisma.user.deleteMany({
          where: { id: athleteId },
        });
      }
    }
  }, 20_000);

  it('should handle concurrent assignment cancellation and relationship termination', async () => {
    let athleteId: string | undefined;
    let relationshipId: string | undefined;
    let assignmentId: string | undefined;

    try {
      const trainer = await prisma.user.findUniqueOrThrow({
        where: { id: trainerId },
        select: { email: true },
      });

      const trainerCookie = await login(trainer.email);

      // Create an isolated athlete.
      const athlete = await prisma.user.create({
        data: {
          email: `cancel-terminate-race-${randomUUID()}@example.com`,
          passwordHash: await passwordHasher.hash(password),
          role: 'ATHLETE',
        },
        select: { id: true },
      });

      athleteId = athlete.id;

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId,
          athleteId: athlete.id,
          initiatedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      relationshipId = relationship.id;

      const original = await prisma.trainingProgramAssignment.findUniqueOrThrow(
        {
          where: { id: programAssignmentId },
          select: { versionId: true },
        },
      );

      const assignment = await prisma.trainingProgramAssignment.create({
        data: {
          versionId: original.versionId,
          trainerAthleteId: relationship.id,
          athleteId: athlete.id,
          assignedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      assignmentId = assignment.id;

      // Run both operations concurrently.
      const [cancelResponse, terminateResponse] = await Promise.all([
        request(app!.getHttpServer())
          .post(`/training-programs/assignments/${assignment.id}/cancel`)
          .set('Cookie', trainerCookie)
          .send({ reason: 'Cancelled by trainer' }),

        request(app!.getHttpServer())
          .post(`/trainer-athletes/${relationship.id}/terminate`)
          .set('Cookie', trainerCookie)
          .send({ reason: 'Collaboration ended' }),
      ]);

      // Relationship termination must succeed.
      expect(terminateResponse.status).toBe(200);
      expect(terminateResponse.body.status).toBe('TERMINATED');

      // Cancellation may win or lose the race.
      expect([200, 409]).toContain(cancelResponse.status);

      const [persistedAssignment, persistedRelationship] = await Promise.all([
        prisma.trainingProgramAssignment.findUniqueOrThrow({
          where: { id: assignment.id },
          select: {
            status: true,
            endedAt: true,
            endedById: true,
            endReason: true,
          },
        }),

        prisma.trainerAthlete.findUniqueOrThrow({
          where: { id: relationship.id },
          select: {
            status: true,
            endedAt: true,
          },
        }),
      ]);

      expect(persistedRelationship.status).toBe('TERMINATED');
      expect(persistedRelationship.endedAt).not.toBeNull();

      expect(persistedAssignment.endedAt).not.toBeNull();
      expect(persistedAssignment.endedById).toBe(trainerId);

      if (cancelResponse.status === 200) {
        expect(persistedAssignment.status).toBe('CANCELLED');
        expect(persistedAssignment.endReason).toBe('Cancelled by trainer');
      } else {
        expect(persistedAssignment.status).toBe('TERMINATED');
        expect(persistedAssignment.endReason).toBe('Collaboration ended');
      }

      // No active assignment may survive the termination.
      const activeCount = await prisma.trainingProgramAssignment.count({
        where: {
          trainerAthleteId: relationship.id,
          status: 'ACTIVE',
        },
      });

      expect(activeCount).toBe(0);
    } finally {
      if (assignmentId) {
        await prisma.trainingProgramAssignment.deleteMany({
          where: { id: assignmentId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: relationshipId },
        });
      }

      if (athleteId) {
        await prisma.user.deleteMany({
          where: { id: athleteId },
        });
      }
    }
  }, 30_000);

  it('should handle concurrent assignment completion and relationship termination', async () => {
    let athleteId: string | undefined;
    let relationshipId: string | undefined;
    let assignmentId: string | undefined;

    try {
      const passwordHash = await passwordHasher.hash(password);

      const trainer = await prisma.user.findUniqueOrThrow({
        where: { id: trainerId },
        select: { email: true },
      });

      // Create an isolated athlete.
      const athlete = await prisma.user.create({
        data: {
          email: `complete-terminate-race-${randomUUID()}@example.com`,
          passwordHash,
          role: 'ATHLETE',
        },
        select: { id: true, email: true },
      });

      athleteId = athlete.id;

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId,
          athleteId: athlete.id,
          initiatedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      relationshipId = relationship.id;

      const original = await prisma.trainingProgramAssignment.findUniqueOrThrow(
        {
          where: { id: programAssignmentId },
          select: { versionId: true },
        },
      );

      // No linked workouts: completion is allowed.
      const assignment = await prisma.trainingProgramAssignment.create({
        data: {
          versionId: original.versionId,
          trainerAthleteId: relationship.id,
          athleteId: athlete.id,
          assignedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      assignmentId = assignment.id;

      // Both participants have their own authenticated sessions.
      const [athleteCookie, trainerCookie] = await Promise.all([
        login(athlete.email),
        login(trainer.email),
      ]);

      // Execute competing HTTP requests.
      const [completeResponse, terminateResponse] = await Promise.all([
        request(app!.getHttpServer())
          .post(`/training-programs/assignments/${assignment.id}/complete`)
          .set('Cookie', athleteCookie),

        request(app!.getHttpServer())
          .post(`/trainer-athletes/${relationship.id}/terminate`)
          .set('Cookie', trainerCookie)
          .send({ reason: 'Concurrent termination test' }),
      ]);

      expect(terminateResponse.status).toBe(200);
      expect(terminateResponse.body.status).toBe('TERMINATED');

      // Completion may win or lose the race.
      expect([200, 409]).toContain(completeResponse.status);

      // Verify final state directly in PostgreSQL.
      const [persistedAssignment, persistedRelationship] = await Promise.all([
        prisma.trainingProgramAssignment.findUniqueOrThrow({
          where: { id: assignment.id },
          select: {
            status: true,
            completedAt: true,
            endedAt: true,
            endedById: true,
            endReason: true,
          },
        }),

        prisma.trainerAthlete.findUniqueOrThrow({
          where: { id: relationship.id },
          select: {
            status: true,
            endedAt: true,
          },
        }),
      ]);

      // Collaboration must always be terminated.
      expect(persistedRelationship.status).toBe('TERMINATED');
      expect(persistedRelationship.endedAt).not.toBeNull();

      if (completeResponse.status === 200) {
        // Completion won the race.
        expect(completeResponse.body).toMatchObject({
          id: assignment.id,
          status: 'COMPLETED',
        });

        expect(persistedAssignment.status).toBe('COMPLETED');
        expect(persistedAssignment.completedAt).not.toBeNull();

        // Termination must not overwrite a completed assignment.
        expect(persistedAssignment.endedAt).toBeNull();
        expect(persistedAssignment.endedById).toBeNull();
      } else {
        // Termination won the race.
        expect(persistedAssignment.status).toBe('TERMINATED');
        expect(persistedAssignment.completedAt).toBeNull();

        expect(persistedAssignment.endedAt).not.toBeNull();
        expect(persistedAssignment.endedById).toBe(trainerId);
        expect(persistedAssignment.endReason).toBe(
          'Concurrent termination test',
        );
      }

      // No active assignment may remain.
      const activeCount = await prisma.trainingProgramAssignment.count({
        where: {
          trainerAthleteId: relationship.id,
          status: 'ACTIVE',
        },
      });

      expect(activeCount).toBe(0);
    } finally {
      if (assignmentId) {
        await prisma.trainingProgramAssignment.deleteMany({
          where: { id: assignmentId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: relationshipId },
        });
      }

      if (athleteId) {
        await prisma.user.deleteMany({
          where: { id: athleteId },
        });
      }
    }
  }, 30_000);

  it('should serialize workout creation with assignment completion', async () => {
    let athleteId: string | undefined;
    let relationshipId: string | undefined;
    let assignmentId: string | undefined;

    try {
      const athlete = await prisma.user.create({
        data: {
          email: `workout-completion-race-${randomUUID()}@example.com`,
          passwordHash: await passwordHasher.hash(password),
          role: 'ATHLETE',
        },
        select: {
          id: true,
          email: true,
        },
      });

      athleteId = athlete.id;

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId,
          athleteId: athlete.id,
          initiatedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      relationshipId = relationship.id;

      const original = await prisma.trainingProgramAssignment.findUniqueOrThrow(
        {
          where: { id: programAssignmentId },
          select: { versionId: true },
        },
      );

      // This assignment starts without any actual workouts.
      const assignment = await prisma.trainingProgramAssignment.create({
        data: {
          versionId: original.versionId,
          trainerAthleteId: relationship.id,
          athleteId: athlete.id,
          assignedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      assignmentId = assignment.id;

      const athleteCookie = await login(athlete.email);

      // Two competing operations on the same assignment.
      const [createResponse, completeResponse] = await Promise.all([
        request(app!.getHttpServer())
          .post('/workouts/from-program')
          .set('Cookie', athleteCookie)
          .send({
            assignmentId: assignment.id,
            programWorkoutId,
          }),

        request(app!.getHttpServer())
          .post(`/training-programs/assignments/${assignment.id}/complete`)
          .set('Cookie', athleteCookie),
      ]);

      // Only these two combinations are valid.
      const statuses = [createResponse.status, completeResponse.status];

      expect([
        [201, 409],
        [404, 200],
      ]).toContainEqual(statuses);

      // Read the final database state.
      const [persistedAssignment, workouts] = await Promise.all([
        prisma.trainingProgramAssignment.findUniqueOrThrow({
          where: { id: assignment.id },
          select: {
            status: true,
            completedAt: true,
          },
        }),

        prisma.workout.findMany({
          where: {
            programAssignmentId: assignment.id,
          },
          select: {
            id: true,
            status: true,
            athleteId: true,
            programWorkoutId: true,
          },
        }),
      ]);

      if (createResponse.status === 201) {
        // Workout creation won.
        expect(createResponse.body).toMatchObject({
          id: expect.any(String),
          status: 'PLANNED',
          athleteId: athlete.id,
          programAssignmentId: assignment.id,
          programWorkoutId,
        });

        expect(completeResponse.status).toBe(409);

        expect(persistedAssignment).toEqual({
          status: 'ACTIVE',
          completedAt: null,
        });

        expect(workouts).toHaveLength(1);
        expect(workouts[0]).toMatchObject({
          id: createResponse.body.id,
          status: 'PLANNED',
          athleteId: athlete.id,
          programWorkoutId,
        });
      } else {
        // Assignment completion won.
        expect(createResponse.status).toBe(404);
        expect(completeResponse.status).toBe(200);

        expect(completeResponse.body).toMatchObject({
          id: assignment.id,
          status: 'COMPLETED',
        });

        expect(persistedAssignment.status).toBe('COMPLETED');
        expect(persistedAssignment.completedAt).not.toBeNull();

        // A completed assignment cannot gain a new workout.
        expect(workouts).toHaveLength(0);
      }

      // The trainer-athlete relationship itself remains active.
      const persistedRelationship =
        await prisma.trainerAthlete.findUniqueOrThrow({
          where: { id: relationship.id },
          select: { status: true },
        });

      expect(persistedRelationship.status).toBe('ACTIVE');
    } finally {
      // Delete dependent workouts before their assignment.
      if (assignmentId) {
        await prisma.workout.deleteMany({
          where: { programAssignmentId: assignmentId },
        });

        await prisma.trainingProgramAssignment.deleteMany({
          where: { id: assignmentId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: relationshipId },
        });
      }

      if (athleteId) {
        await prisma.user.deleteMany({
          where: { id: athleteId },
        });
      }
    }
  }, 30_000);

  it('should serialize workout creation with assignment cancellation', async () => {
    let athleteId: string | undefined;
    let relationshipId: string | undefined;
    let assignmentId: string | undefined;

    try {
      const trainer = await prisma.user.findUniqueOrThrow({
        where: { id: trainerId },
        select: { email: true },
      });

      const athlete = await prisma.user.create({
        data: {
          email: `workout-cancel-race-${randomUUID()}@example.com`,
          passwordHash: await passwordHasher.hash(password),
          role: 'ATHLETE',
        },
        select: { id: true, email: true },
      });

      athleteId = athlete.id;

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId,
          athleteId: athlete.id,
          initiatedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      relationshipId = relationship.id;

      const original = await prisma.trainingProgramAssignment.findUniqueOrThrow(
        {
          where: { id: programAssignmentId },
          select: { versionId: true },
        },
      );

      const assignment = await prisma.trainingProgramAssignment.create({
        data: {
          versionId: original.versionId,
          trainerAthleteId: relationship.id,
          athleteId: athlete.id,
          assignedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      assignmentId = assignment.id;

      const [athleteCookie, trainerCookie] = await Promise.all([
        login(athlete.email),
        login(trainer.email),
      ]);

      // Execute competing operations.
      const [createResponse, cancelResponse] = await Promise.all([
        request(app!.getHttpServer())
          .post('/workouts/from-program')
          .set('Cookie', athleteCookie)
          .send({
            assignmentId: assignment.id,
            programWorkoutId,
          }),

        request(app!.getHttpServer())
          .post(`/training-programs/assignments/${assignment.id}/cancel`)
          .set('Cookie', trainerCookie)
          .send({ reason: 'Concurrent cancellation test' }),
      ]);

      // Cancellation must succeed.
      expect(cancelResponse.status).toBe(200);
      expect(cancelResponse.body).toMatchObject({
        id: assignment.id,
        status: 'CANCELLED',
      });

      // Workout creation may win or lose.
      expect([201, 404]).toContain(createResponse.status);

      // Verify the persisted database state.
      const [persistedAssignment, workouts] = await Promise.all([
        prisma.trainingProgramAssignment.findUniqueOrThrow({
          where: { id: assignment.id },
          select: {
            status: true,
            endedAt: true,
            endedById: true,
            endReason: true,
          },
        }),

        prisma.workout.findMany({
          where: { programAssignmentId: assignment.id },
          select: {
            id: true,
            status: true,
            athleteId: true,
            programWorkoutId: true,
          },
        }),
      ]);

      expect(persistedAssignment.status).toBe('CANCELLED');
      expect(persistedAssignment.endedAt).not.toBeNull();
      expect(persistedAssignment.endedById).toBe(trainerId);
      expect(persistedAssignment.endReason).toBe(
        'Concurrent cancellation test',
      );

      if (createResponse.status === 201) {
        // Creation won, then cancellation succeeded.
        expect(workouts).toHaveLength(1);

        expect(workouts[0]).toMatchObject({
          id: createResponse.body.id,
          status: 'PLANNED',
          athleteId: athlete.id,
          programWorkoutId,
        });

        // A workout from a canceled assignment cannot be started.
        const startResponse = await request(app!.getHttpServer())
          .post(`/workouts/${workouts[0].id}/start`)
          .set('Cookie', athleteCookie);

        expect(startResponse.status).toBe(409);

        const persistedWorkout = await prisma.workout.findUniqueOrThrow({
          where: { id: workouts[0].id },
          select: { status: true, startedAt: true },
        });

        expect(persistedWorkout).toEqual({
          status: 'PLANNED',
          startedAt: null,
        });
      } else {
        // Cancellation won before workout creation.
        expect(createResponse.status).toBe(404);
        expect(workouts).toHaveLength(0);
      }

      // No subsequent workout can be created after cancellation.
      const retryResponse = await request(app!.getHttpServer())
        .post('/workouts/from-program')
        .set('Cookie', athleteCookie)
        .send({
          assignmentId: assignment.id,
          programWorkoutId,
        });

      expect(retryResponse.status).toBe(404);

      // Cancelling the assignment does not terminate collaboration.
      const persistedRelationship =
        await prisma.trainerAthlete.findUniqueOrThrow({
          where: { id: relationship.id },
          select: { status: true },
        });

      expect(persistedRelationship.status).toBe('ACTIVE');
    } finally {
      if (assignmentId) {
        await prisma.workout.deleteMany({
          where: { programAssignmentId: assignmentId },
        });

        await prisma.trainingProgramAssignment.deleteMany({
          where: { id: assignmentId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: relationshipId },
        });
      }

      if (athleteId) {
        await prisma.user.deleteMany({
          where: { id: athleteId },
        });
      }
    }
  }, 30_000);

  it('should serialize workout creation with relationship termination', async () => {
    let athleteId: string | undefined;
    let relationshipId: string | undefined;
    let assignmentId: string | undefined;

    try {
      const trainer = await prisma.user.findUniqueOrThrow({
        where: { id: trainerId },
        select: { email: true },
      });

      const athlete = await prisma.user.create({
        data: {
          email: `workout-terminate-race-${randomUUID()}@example.com`,
          passwordHash: await passwordHasher.hash(password),
          role: 'ATHLETE',
        },
        select: { id: true, email: true },
      });

      athleteId = athlete.id;

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId,
          athleteId: athlete.id,
          initiatedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      relationshipId = relationship.id;

      const original = await prisma.trainingProgramAssignment.findUniqueOrThrow(
        {
          where: { id: programAssignmentId },
          select: { versionId: true },
        },
      );

      const assignment = await prisma.trainingProgramAssignment.create({
        data: {
          versionId: original.versionId,
          trainerAthleteId: relationship.id,
          athleteId: athlete.id,
          assignedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      assignmentId = assignment.id;

      const [athleteCookie, trainerCookie] = await Promise.all([
        login(athlete.email),
        login(trainer.email),
      ]);

      // Run both HTTP requests concurrently.
      const [createResponse, terminateResponse] = await Promise.all([
        request(app!.getHttpServer())
          .post('/workouts/from-program')
          .set('Cookie', athleteCookie)
          .send({
            assignmentId: assignment.id,
            programWorkoutId,
          }),

        request(app!.getHttpServer())
          .post(`/trainer-athletes/${relationship.id}/terminate`)
          .set('Cookie', trainerCookie)
          .send({ reason: 'Concurrent relationship termination' }),
      ]);

      // Termination must succeed.
      expect(terminateResponse.status).toBe(200);
      expect(terminateResponse.body.status).toBe('TERMINATED');

      // Creation can either succeed before termination or be rejected.
      expect([201, 404]).toContain(createResponse.status);

      const [persistedRelationship, persistedAssignment, workouts] =
        await Promise.all([
          prisma.trainerAthlete.findUniqueOrThrow({
            where: { id: relationship.id },
            select: {
              status: true,
              endedAt: true,
            },
          }),

          prisma.trainingProgramAssignment.findUniqueOrThrow({
            where: { id: assignment.id },
            select: {
              status: true,
              endedAt: true,
              endedById: true,
              endReason: true,
            },
          }),

          prisma.workout.findMany({
            where: {
              programAssignmentId: assignment.id,
            },
            select: {
              id: true,
              status: true,
              athleteId: true,
              programWorkoutId: true,
            },
          }),
        ]);

      // Collaboration and its active assignment must be terminated.
      expect(persistedRelationship.status).toBe('TERMINATED');
      expect(persistedRelationship.endedAt).not.toBeNull();

      expect(persistedAssignment.status).toBe('TERMINATED');
      expect(persistedAssignment.endedAt).not.toBeNull();
      expect(persistedAssignment.endedById).toBe(trainerId);
      expect(persistedAssignment.endReason).toBe(
        'Concurrent relationship termination',
      );

      if (createResponse.status === 201) {
        // Workout creation won before termination completed.
        expect(workouts).toHaveLength(1);

        expect(workouts[0]).toMatchObject({
          id: createResponse.body.id,
          status: 'PLANNED',
          athleteId: athlete.id,
          programWorkoutId,
        });

        // The athlete cannot start the workout after termination.
        const startResponse = await request(app!.getHttpServer())
          .post(`/workouts/${workouts[0].id}/start`)
          .set('Cookie', athleteCookie);

        expect(startResponse.status).toBe(409);
      } else {
        // Termination won: no workout should have been created.
        expect(createResponse.status).toBe(404);
        expect(workouts).toHaveLength(0);
      }

      // A retry after termination must always fail.
      const retryResponse = await request(app!.getHttpServer())
        .post('/workouts/from-program')
        .set('Cookie', athleteCookie)
        .send({
          assignmentId: assignment.id,
          programWorkoutId,
        });

      expect(retryResponse.status).toBe(404);

      // No active assignments may survive.
      const activeCount = await prisma.trainingProgramAssignment.count({
        where: {
          trainerAthleteId: relationship.id,
          status: 'ACTIVE',
        },
      });

      expect(activeCount).toBe(0);
    } finally {
      if (assignmentId) {
        await prisma.workout.deleteMany({
          where: { programAssignmentId: assignmentId },
        });

        await prisma.trainingProgramAssignment.deleteMany({
          where: { id: assignmentId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: relationshipId },
        });
      }

      if (athleteId) {
        await prisma.user.deleteMany({
          where: { id: athleteId },
        });
      }
    }
  }, 30_000);

  it('should preserve trainer exercise copies during concurrent workout creation and termination', async () => {
    let athleteId: string | undefined;
    let relationshipId: string | undefined;
    let assignmentId: string | undefined;
    let programId: string | undefined;
    let sourceExerciseId: string | undefined;

    try {
      const trainer = await prisma.user.findUniqueOrThrow({
        where: { id: trainerId },
        select: { email: true },
      });

      const athlete = await prisma.user.create({
        data: {
          email: `exercise-copy-race-${randomUUID()}@example.com`,
          passwordHash: await passwordHasher.hash(password),
          role: 'ATHLETE',
        },
        select: { id: true, email: true },
      });

      athleteId = athlete.id;

      // 1. Create a trainer-owned custom exercise.
      const sourceExercise = await prisma.exercise.create({
        data: {
          name: 'Trainer Custom Bench Press',
          description: 'Exercise created by the trainer',
          instructions: 'Perform 8 controlled repetitions',
          source: 'TRAINER_CUSTOM',
          exerciseType: 'STRENGTH',
          createdById: trainerId,
        },
        select: { id: true },
      });

      sourceExerciseId = sourceExercise.id;

      // 2. Create an isolated published program.
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
          programId: program.id,
          version: 1,
          title: 'Trainer Custom Exercise Program',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
        select: { id: true },
      });

      const programWorkout = await prisma.trainingProgramWorkout.create({
        data: {
          versionId: version.id,
          weekNumber: 1,
          dayNumber: 1,
          title: 'Trainer Custom Workout',
        },
        select: { id: true },
      });

      const programExercise = await prisma.trainingProgramExercise.create({
        data: {
          workoutId: programWorkout.id,
          exerciseId: sourceExercise.id,
          exerciseNameSnapshot: 'Trainer Custom Bench Press',
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

      // 3. Create an active trainer-athlete relationship.
      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId,
          athleteId: athlete.id,
          initiatedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      relationshipId = relationship.id;

      const assignment = await prisma.trainingProgramAssignment.create({
        data: {
          versionId: version.id,
          trainerAthleteId: relationship.id,
          athleteId: athlete.id,
          assignedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      assignmentId = assignment.id;

      const [athleteCookie, trainerCookie] = await Promise.all([
        login(athlete.email),
        login(trainer.email),
      ]);

      // 4. Run competing HTTP requests.
      const [createResponse, terminateResponse] = await Promise.all([
        request(app!.getHttpServer())
          .post('/workouts/from-program')
          .set('Cookie', athleteCookie)
          .send({
            assignmentId: assignment.id,
            programWorkoutId: programWorkout.id,
          }),

        request(app!.getHttpServer())
          .post(`/trainer-athletes/${relationship.id}/terminate`)
          .set('Cookie', trainerCookie)
          .send({ reason: 'Exercise copy race test' }),
      ]);

      expect(terminateResponse.status).toBe(200);
      expect(terminateResponse.body.status).toBe('TERMINATED');

      expect([201, 404]).toContain(createResponse.status);

      // 5. Check persisted assignment and relationship.
      const [persistedAssignment, persistedRelationship] = await Promise.all([
        prisma.trainingProgramAssignment.findUniqueOrThrow({
          where: { id: assignment.id },
          select: { status: true },
        }),

        prisma.trainerAthlete.findUniqueOrThrow({
          where: { id: relationship.id },
          select: { status: true },
        }),
      ]);

      expect(persistedAssignment.status).toBe('TERMINATED');
      expect(persistedRelationship.status).toBe('TERMINATED');

      // 6. The athlete must receive exactly ONE private copy.
      const copies = await prisma.exercise.findMany({
        where: {
          createdById: athlete.id,
          copiedFromExerciseId: sourceExercise.id,
        },
        select: {
          id: true,
          name: true,
          description: true,
          instructions: true,
          source: true,
          visibility: true,
          isArchived: true,
          createdById: true,
          copiedFromExerciseId: true,
        },
      });

      expect(copies).toHaveLength(1);

      expect(copies[0]).toMatchObject({
        name: 'Trainer Custom Bench Press',
        description: 'Exercise created by the trainer',
        instructions: 'Perform 8 controlled repetitions',
        source: 'ATHLETE_CUSTOM',
        visibility: 'PRIVATE',
        isArchived: false,
        createdById: athlete.id,
        copiedFromExerciseId: sourceExercise.id,
      });

      expect(copies[0].id).not.toBe(sourceExercise.id);

      // 7. Access to the original must be revoked.
      const originalResponse = await request(app!.getHttpServer())
        .get(`/exercises/${sourceExercise.id}`)
        .set('Cookie', athleteCookie);

      expect(originalResponse.status).toBe(404);

      // The athlete can still access their private copy.
      const copyResponse = await request(app!.getHttpServer())
        .get(`/exercises/${copies[0].id}`)
        .set('Cookie', athleteCookie);

      expect(copyResponse.status).toBe(200);
      expect(copyResponse.body.id).toBe(copies[0].id);

      // 8. Verify the workout creation outcome.
      const workouts = await prisma.workout.findMany({
        where: {
          programAssignmentId: assignment.id,
        },
        select: {
          id: true,
          status: true,
          exercises: {
            select: {
              exerciseId: true,
              exerciseNameSnapshot: true,
              sets: {
                select: { plannedReps: true },
              },
            },
          },
        },
      });

      if (createResponse.status === 201) {
        expect(workouts).toHaveLength(1);

        expect(workouts[0]).toMatchObject({
          id: createResponse.body.id,
          status: 'PLANNED',
          exercises: [
            {
              exerciseId: sourceExercise.id,
              exerciseNameSnapshot: 'Trainer Custom Bench Press',
              sets: [{ plannedReps: 8 }],
            },
          ],
        });

        // The workout retains its historical reference
        // but cannot be started after termination.
        const startResponse = await request(app!.getHttpServer())
          .post(`/workouts/${workouts[0].id}/start`)
          .set('Cookie', athleteCookie);

        expect(startResponse.status).toBe(409);
      } else {
        expect(workouts).toHaveLength(0);
      }

      // 9. No new workout can be created after termination.
      const retryResponse = await request(app!.getHttpServer())
        .post('/workouts/from-program')
        .set('Cookie', athleteCookie)
        .send({
          assignmentId: assignment.id,
          programWorkoutId: programWorkout.id,
        });

      expect(retryResponse.status).toBe(404);
    } finally {
      // Remove dependent workouts first.
      if (assignmentId) {
        await prisma.workout.deleteMany({
          where: { programAssignmentId: assignmentId },
        });

        await prisma.trainingProgramAssignment.deleteMany({
          where: { id: assignmentId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: relationshipId },
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

      // Copies reference the original, so delete them first.
      if (sourceExerciseId && athleteId) {
        await prisma.exercise.deleteMany({
          where: {
            copiedFromExerciseId: sourceExerciseId,
            createdById: athleteId,
          },
        });
      }

      if (sourceExerciseId) {
        await prisma.exercise.deleteMany({
          where: { id: sourceExerciseId },
        });
      }

      if (athleteId) {
        await prisma.user.deleteMany({
          where: { id: athleteId },
        });
      }
    }
  }, 30_000);

  it('should preserve completed workout history after trainer relationship termination', async () => {
    let athleteId: string | undefined;
    let relationshipId: string | undefined;
    let assignmentId: string | undefined;
    let programId: string | undefined;
    let sourceExerciseId: string | undefined;

    try {
      const trainer = await prisma.user.findUniqueOrThrow({
        where: { id: trainerId },
        select: { email: true },
      });

      const athlete = await prisma.user.create({
        data: {
          email: `workout-history-${randomUUID()}@example.com`,
          passwordHash: await passwordHasher.hash(password),
          role: 'ATHLETE',
        },
        select: { id: true, email: true },
      });

      athleteId = athlete.id;

      const sourceExercise = await prisma.exercise.create({
        data: {
          name: 'Original Trainer Press',
          source: 'TRAINER_CUSTOM',
          exerciseType: 'STRENGTH',
          createdById: trainerId,
        },
        select: { id: true },
      });

      sourceExerciseId = sourceExercise.id;

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
          programId: program.id,
          version: 1,
          title: 'Historical Workout Program',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
        select: { id: true },
      });

      const programWorkout = await prisma.trainingProgramWorkout.create({
        data: {
          versionId: version.id,
          weekNumber: 1,
          dayNumber: 1,
          title: 'Historical Strength Workout',
        },
        select: { id: true },
      });

      const programExercise = await prisma.trainingProgramExercise.create({
        data: {
          workoutId: programWorkout.id,
          exerciseId: sourceExercise.id,
          exerciseNameSnapshot: 'Original Trainer Press',
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
          plannedReps: 10,
          plannedWeightKg: 60,
        },
      });

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId,
          athleteId: athlete.id,
          initiatedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      relationshipId = relationship.id;

      const assignment = await prisma.trainingProgramAssignment.create({
        data: {
          versionId: version.id,
          trainerAthleteId: relationship.id,
          athleteId: athlete.id,
          assignedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      assignmentId = assignment.id;

      const [athleteCookie, trainerCookie] = await Promise.all([
        login(athlete.email),
        login(trainer.email),
      ]);

      // 1. Create an actual workout.
      const created = await request(app!.getHttpServer())
        .post('/workouts/from-program')
        .set('Cookie', athleteCookie)
        .send({
          assignmentId: assignment.id,
          programWorkoutId: programWorkout.id,
        });

      expect(created.status).toBe(201);

      const workoutId = created.body.id as string;
      const setId = created.body.exercises[0].sets[0].id as string;

      // 2. Start the workout.
      const started = await request(app!.getHttpServer())
        .post(`/workouts/${workoutId}/start`)
        .set('Cookie', athleteCookie);

      expect(started.status).toBe(200);
      expect(started.body.status).toBe('IN_PROGRESS');

      // 3. Record actual performance.
      const updatedSet = await request(app!.getHttpServer())
        .patch(`/workouts/${workoutId}/sets/${setId}`)
        .set('Cookie', athleteCookie)
        .send({
          status: 'COMPLETED',
          actualReps: 8,
          actualWeightKg: 60,
          rpe: 8,
          rir: 2,
        });

      expect(updatedSet.status).toBe(200);

      // 4. Complete the workout.
      const completed = await request(app!.getHttpServer())
        .post(`/workouts/${workoutId}/complete`)
        .set('Cookie', athleteCookie);

      expect(completed.status).toBe(200);
      expect(completed.body.status).toBe('COMPLETED');

      // 5. Terminate collaboration.
      const terminated = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${relationship.id}/terminate`)
        .set('Cookie', trainerCookie)
        .send({ reason: 'Historical data preservation test' });

      expect(terminated.status).toBe(200);
      expect(terminated.body.status).toBe('TERMINATED');

      // 6. The original trainer exercise is now inaccessible.
      const originalResponse = await request(app!.getHttpServer())
        .get(`/exercises/${sourceExercise.id}`)
        .set('Cookie', athleteCookie);

      expect(originalResponse.status).toBe(404);

      // The athlete received a personal copy.
      const copies = await prisma.exercise.findMany({
        where: {
          copiedFromExerciseId: sourceExercise.id,
          createdById: athlete.id,
        },
        select: {
          id: true,
          source: true,
          visibility: true,
        },
      });

      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({
        source: 'ATHLETE_CUSTOM',
        visibility: 'PRIVATE',
      });

      const copyResponse = await request(app!.getHttpServer())
        .get(`/exercises/${copies[0].id}`)
        .set('Cookie', athleteCookie);

      expect(copyResponse.status).toBe(200);

      // 7. Trainer changes and archives the original exercise.
      await prisma.exercise.update({
        where: { id: sourceExercise.id },
        data: {
          name: 'Renamed And Archived Trainer Press',
          isArchived: true,
        },
      });

      // 8. Historical workout must remain unchanged.
      const historical = await request(app!.getHttpServer())
        .get(`/workouts/${workoutId}`)
        .set('Cookie', athleteCookie);

      expect(historical.status).toBe(200);

      expect(historical.body).toMatchObject({
        id: workoutId,
        status: 'COMPLETED',
        athleteId: athlete.id,
        programAssignmentId: assignment.id,
        exercises: [
          {
            exerciseId: sourceExercise.id,
            exerciseNameSnapshot: 'Original Trainer Press',
            exerciseTypeSnapshot: 'STRENGTH',
            sets: [
              {
                status: 'COMPLETED',
                plannedReps: 10,
                plannedWeightKg: '60',
                actualReps: 8,
                actualWeightKg: '60',
                rpe: '8',
                rir: 2,
              },
            ],
          },
        ],
      });

      expect(historical.body.completedAt).toBeTruthy();

      // 9. Another athlete cannot read the history.
      const unrelatedResponse = await request(app!.getHttpServer())
        .get(`/workouts/${workoutId}`)
        .set('Cookie', otherAthleteCookie);

      expect(unrelatedResponse.status).toBe(404);

      // Former trainer cannot access an athlete-only endpoint.
      const trainerResponse = await request(app!.getHttpServer())
        .get(`/workouts/${workoutId}`)
        .set('Cookie', trainerCookie);

      expect(trainerResponse.status).toBe(403);

      // 10. Historical workout remains in the athlete's list.
      const listResponse = await request(app!.getHttpServer())
        .get('/workouts')
        .set('Cookie', athleteCookie)
        .query({ status: 'COMPLETED' });

      expect(listResponse.status).toBe(200);

      expect(
        listResponse.body.data.map((item: { id: string }) => item.id),
      ).toContain(workoutId);
    } finally {
      if (assignmentId) {
        await prisma.workout.deleteMany({
          where: { programAssignmentId: assignmentId },
        });

        await prisma.trainingProgramAssignment.deleteMany({
          where: { id: assignmentId },
        });
      }

      if (relationshipId) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: relationshipId },
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

      // Copies must be deleted before their original.
      if (sourceExerciseId && athleteId) {
        await prisma.exercise.deleteMany({
          where: {
            copiedFromExerciseId: sourceExerciseId,
            createdById: athleteId,
          },
        });
      }

      if (sourceExerciseId) {
        await prisma.exercise.deleteMany({
          where: { id: sourceExerciseId },
        });
      }

      if (athleteId) {
        await prisma.user.deleteMany({
          where: { id: athleteId },
        });
      }
    }
  }, 30_000);

  it('should hide athlete email from former trainers across relationship endpoints', async () => {
    let athleteId: string | undefined;
    let relationshipId: string | undefined;

    try {
      const trainer = await prisma.user.findUniqueOrThrow({
        where: { id: trainerId },
        select: { email: true },
      });

      const athlete = await prisma.user.create({
        data: {
          email: `relationship-privacy-${randomUUID()}@example.com`,
          passwordHash: await passwordHasher.hash(password),
          role: 'ATHLETE',
        },
        select: {
          id: true,
          email: true,
        },
      });

      athleteId = athlete.id;

      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId,
          athleteId: athlete.id,
          initiatedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      relationshipId = relationship.id;

      const trainerCookie = await login(trainer.email);

      // Active trainer may see athlete contact information.
      const activeResponse = await request(app!.getHttpServer())
        .get(`/trainer-athletes/${relationship.id}`)
        .set('Cookie', trainerCookie);

      expect(activeResponse.status).toBe(200);
      expect(activeResponse.body.athlete.email).toBe(athlete.email);

      // Terminate collaboration.
      const terminated = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${relationship.id}/terminate`)
        .set('Cookie', trainerCookie)
        .send({ reason: 'Privacy verification' });

      expect(terminated.status).toBe(200);
      expect(terminated.body.status).toBe('TERMINATED');

      // Read historical relationship details.
      const details = await request(app!.getHttpServer())
        .get(`/trainer-athletes/${relationship.id}`)
        .set('Cookie', trainerCookie);

      expect(details.status).toBe(200);
      expect(details.body.status).toBe('TERMINATED');

      // Read historical relationships list.
      const list = await request(app!.getHttpServer())
        .get('/trainer-athletes')
        .set('Cookie', trainerCookie)
        .query({
          status: 'TERMINATED',
          page: 1,
          limit: 100,
        });

      expect(list.status).toBe(200);

      const historicalItem = list.body.data.find(
        (item: { id: string }) => item.id === relationship.id,
      );

      expect(historicalItem).toBeDefined();

      // Historical metadata must remain available.
      expect(details.body).toMatchObject({
        id: relationship.id,
        trainerId,
        athleteId: athlete.id,
        status: 'TERMINATED',
      });

      // But the former trainer must not receive the athlete email.
      // Check the entire JSON payload to catch nested leaks.
      expect.soft(JSON.stringify(terminated.body)).not.toContain(athlete.email);

      expect.soft(JSON.stringify(details.body)).not.toContain(athlete.email);

      expect.soft(JSON.stringify(historicalItem)).not.toContain(athlete.email);
    } finally {
      if (relationshipId) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: relationshipId },
        });
      }

      if (athleteId) {
        await prisma.user.deleteMany({
          where: { id: athleteId },
        });
      }
    }
  }, 20_000);

  it('should reject set updates when workout completes during the request', async () => {
    let workoutId: string | undefined;

    try {
      // 1. Create an isolated workout.
      const created = await request(app!.getHttpServer())
        .post('/workouts')
        .set('Cookie', ownerCookie)
        .send(workoutPayload('Concurrent Set Update Test'));

      expect(created.status).toBe(201);

      workoutId = created.body.id as string;

      const setIds = (
        created.body.exercises[0].sets as Array<{ id: string }>
      ).map((set) => set.id);

      expect(setIds).toHaveLength(2);

      // 2. Start the workout.
      const started = await request(app!.getHttpServer())
        .post(`/workouts/${workoutId}/start`)
        .set('Cookie', ownerCookie);

      expect(started.status).toBe(200);

      // 3. Complete both sets so workout completion is allowed.
      for (const setId of setIds) {
        const response = await request(app!.getHttpServer())
          .patch(`/workouts/${workoutId}/sets/${setId}`)
          .set('Cookie', ownerCookie)
          .send({
            status: 'COMPLETED',
            actualReps: 8,
            actualWeightKg: 60,
          });

        expect(response.status).toBe(200);
      }

      // 4. Intercept repository.updateSet().
      // The service has already checked IN_PROGRESS by this point.
      const repository = app!.get(WorkoutsRepository);
      const originalUpdateSet = repository.updateSet.bind(repository);

      let notifyUpdateEntered!: () => void;
      let resumeUpdate!: () => void;

      const updateEntered = new Promise<void>((resolve) => {
        notifyUpdateEntered = resolve;
      });

      const allowUpdate = new Promise<void>((resolve) => {
        resumeUpdate = resolve;
      });

      const updateSpy = vi
        .spyOn(repository, 'updateSet')
        .mockImplementation(async (setId, data) => {
          notifyUpdateEntered();

          // Pause before writing to PostgreSQL.
          await allowUpdate;

          return originalUpdateSet(setId, data);
        });

      let pendingUpdate: Promise<unknown> | undefined;

      try {
        // 5. Begin an update, but pause it before database write.
        const updateRequest = request(app!.getHttpServer())
          .patch(`/workouts/${workoutId}/sets/${setIds[0]}`)
          .set('Cookie', ownerCookie)
          .send({
            status: 'COMPLETED',
            actualReps: 99,
            actualWeightKg: 100,
          });

        const updateResponsePromise = updateRequest.then(
          (response) => response,
        );

        pendingUpdate = updateResponsePromise;

        // Wait until updateSet() reaches the repository.
        await updateEntered;

        // 6. Complete the workout while the set update is paused.
        const completed = await request(app!.getHttpServer())
          .post(`/workouts/${workoutId}/complete`)
          .set('Cookie', ownerCookie);

        expect(completed.status).toBe(200);
        expect(completed.body.status).toBe('COMPLETED');

        // 7. Resume the old update request.
        resumeUpdate();

        const updateResponse = await updateResponsePromise;

        // An update cannot modify a completed workout.
        expect(updateResponse.status).toBe(409);

        // 8. Verify persisted data.
        const persisted = await prisma.workout.findUniqueOrThrow({
          where: { id: workoutId },
          select: {
            status: true,
            completedAt: true,
            exercises: {
              select: {
                sets: {
                  where: { id: setIds[0] },
                  select: {
                    status: true,
                    actualReps: true,
                    actualWeightKg: true,
                  },
                },
              },
            },
          },
        });

        expect(persisted.status).toBe('COMPLETED');
        expect(persisted.completedAt).not.toBeNull();

        const persistedSet = persisted.exercises[0].sets[0];

        expect(persistedSet).toMatchObject({
          status: 'COMPLETED',
          actualReps: 8,
        });

        expect(persistedSet.actualWeightKg?.toString()).toBe('60');
      } finally {
        // Always release a paused request, even if an assertion fails.
        resumeUpdate();

        if (pendingUpdate) {
          await pendingUpdate.catch(() => undefined);
        }

        updateSpy.mockRestore();
      }
    } finally {
      if (workoutId) {
        await prisma.workout.deleteMany({
          where: { id: workoutId },
        });
      }
    }
  }, 30_000);

  it('should reject completion when set results change concurrently', async () => {
    let workoutId: string | undefined;

    try {
      const workout = await createWorkout('Concurrent Workout Completion Test');

      workoutId = workout.id;

      const started = await request(app!.getHttpServer())
        .post(`/workouts/${workoutId}/start`)
        .set('Cookie', ownerCookie);

      expect(started.status).toBe(200);

      const details = await request(app!.getHttpServer())
        .get(`/workouts/${workoutId}`)
        .set('Cookie', ownerCookie);

      expect(details.status).toBe(200);

      const sets = details.body.exercises[0].sets as Array<{
        id: string;
      }>;

      expect(sets).toHaveLength(2);

      // One completed set and one skipped set.
      const completedSet = await request(app!.getHttpServer())
        .patch(`/workouts/${workoutId}/sets/${sets[0].id}`)
        .set('Cookie', ownerCookie)
        .send({
          status: 'COMPLETED',
          actualReps: 8,
          actualWeightKg: 60,
        });

      expect(completedSet.status).toBe(200);

      const skippedSet = await request(app!.getHttpServer())
        .patch(`/workouts/${workoutId}/sets/${sets[1].id}`)
        .set('Cookie', ownerCookie)
        .send({ status: 'SKIPPED' });

      expect(skippedSet.status).toBe(200);

      const repository = app!.get(WorkoutsRepository);
      const originalFindById = repository.findById.bind(repository);

      let notifyReadCompleted!: () => void;
      let resumeCompletion!: () => void;
      let completionBlocked = false;

      const readCompleted = new Promise<void>((resolve) => {
        notifyReadCompleted = resolve;
      });

      const allowCompletion = new Promise<void>((resolve) => {
        resumeCompletion = resolve;
      });

      // Pause completion after the repository returns
      // the original snapshot, but before the service uses it.
      const findSpy = vi
        .spyOn(repository, 'findById')
        .mockImplementation(async (id, where) => {
          const result = await originalFindById(id, where);

          if (id === workoutId && !completionBlocked) {
            completionBlocked = true;
            notifyReadCompleted();
            await allowCompletion;
          }

          return result;
        });

      let pendingCompletion: Promise<unknown> | undefined;

      try {
        const completionRequest = request(app!.getHttpServer())
          .post(`/workouts/${workoutId}/complete`)
          .set('Cookie', ownerCookie);

        const completionPromise = completionRequest.then(
          (response) => response,
        );

        pendingCompletion = completionPromise;

        // Wait until complete() has read the original set statuses.
        await readCompleted;

        // Change the only completed set to SKIPPED.
        const concurrentUpdate = await request(app!.getHttpServer())
          .patch(`/workouts/${workoutId}/sets/${sets[0].id}`)
          .set('Cookie', ownerCookie)
          .send({ status: 'SKIPPED' });

        expect(concurrentUpdate.status).toBe(200);

        // The workout now contains no completed sets.
        resumeCompletion();

        const completionResponse = await completionPromise;

        expect(completionResponse.status).toBe(409);

        const persisted = await prisma.workout.findUniqueOrThrow({
          where: { id: workoutId },
          select: {
            status: true,
            completedAt: true,
            exercises: {
              select: {
                sets: {
                  select: { status: true },
                },
              },
            },
          },
        });

        expect(persisted.status).toBe('IN_PROGRESS');
        expect(persisted.completedAt).toBeNull();

        const statuses = persisted.exercises.flatMap((exercise) =>
          exercise.sets.map((set) => set.status),
        );

        expect(statuses).toEqual(['SKIPPED', 'SKIPPED']);
      } finally {
        resumeCompletion();

        if (pendingCompletion) {
          await pendingCompletion.catch(() => undefined);
        }

        findSpy.mockRestore();
      }
    } finally {
      if (workoutId) {
        await prisma.workout.deleteMany({
          where: { id: workoutId },
        });
      }
    }
  }, 30_000);

  it('should reject set updates when workout is cancelled concurrently', async () => {
    const workout = await createWorkout('Concurrent Workout Cancellation Test');

    try {
      const started = await request(app!.getHttpServer())
        .post(`/workouts/${workout.id}/start`)
        .set('Cookie', ownerCookie);

      expect(started.status).toBe(200);

      const details = await request(app!.getHttpServer())
        .get(`/workouts/${workout.id}`)
        .set('Cookie', ownerCookie);

      expect(details.status).toBe(200);

      const setId = details.body.exercises[0].sets[0].id as string;

      const repository = app!.get(WorkoutsRepository);
      const originalUpdateSet = repository.updateSet.bind(repository);

      let notifyEntered!: () => void;
      let resumeUpdate!: () => void;

      const entered = new Promise<void>((resolve) => {
        notifyEntered = resolve;
      });

      const allowed = new Promise<void>((resolve) => {
        resumeUpdate = resolve;
      });

      const spy = vi
        .spyOn(repository, 'updateSet')
        .mockImplementation(async (id, data) => {
          notifyEntered();
          await allowed;

          return originalUpdateSet(id, data);
        });

      let pendingUpdate: Promise<unknown> | undefined;

      try {
        const updatePromise = request(app!.getHttpServer())
          .patch(`/workouts/${workout.id}/sets/${setId}`)
          .set('Cookie', ownerCookie)
          .send({
            status: 'COMPLETED',
            actualReps: 10,
            actualWeightKg: 80,
          })
          .then((response) => response);

        pendingUpdate = updatePromise;

        // Wait until updateSet reaches the repository.
        await entered;

        // Cancel the workout before the set update writes to DB.
        const cancelled = await request(app!.getHttpServer())
          .post(`/workouts/${workout.id}/cancel`)
          .set('Cookie', ownerCookie);

        expect(cancelled.status).toBe(200);
        expect(cancelled.body.status).toBe('CANCELLED');

        // Resume the original update.
        resumeUpdate();

        const updateResponse = await updatePromise;

        expect(updateResponse.status).toBe(409);

        const persisted = await prisma.workout.findUniqueOrThrow({
          where: { id: workout.id },
          select: {
            status: true,
            exercises: {
              select: {
                sets: {
                  where: { id: setId },
                  select: {
                    status: true,
                    actualReps: true,
                    actualWeightKg: true,
                  },
                },
              },
            },
          },
        });

        expect(persisted.status).toBe('CANCELLED');

        const persistedSet = persisted.exercises.flatMap(
          (exercise) => exercise.sets,
        )[0];

        expect(persistedSet).toMatchObject({
          status: 'PENDING',
          actualReps: null,
          actualWeightKg: null,
        });
      } finally {
        resumeUpdate();

        if (pendingUpdate) {
          await pendingUpdate.catch(() => undefined);
        }

        spy.mockRestore();
      }
    } finally {
      await prisma.workout.deleteMany({
        where: { id: workout.id },
      });
    }
  }, 30_000);

  describe('POST /workouts', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await request(app!.getHttpServer())
        .post('/workouts')
        .send(workoutPayload());

      expect(response.status).toBe(401);
    });

    it('should reject attempts to override protected fields', async () => {
      const response = await request(app!.getHttpServer())
        .post('/workouts')
        .set('Cookie', ownerCookie)
        .send({
          ...workoutPayload(),
          athleteId: 'another-athlete',
          createdById: 'another-user',
          status: 'COMPLETED',
        });

      expect(response.status).toBe(400);
    });

    it('should reject another athlete private exercise', async () => {
      const response = await request(app!.getHttpServer())
        .post('/workouts')
        .set('Cookie', ownerCookie)
        .send({
          title: 'Invalid Workout',
          exercises: [
            {
              exerciseId: privateExerciseId,
              sets: [{ plannedReps: 10 }],
            },
          ],
        });

      expect(response.status).toBe(400);
    });

    it('should create a workout with exercises and planned sets', async () => {
      const response = await request(app!.getHttpServer())
        .post('/workouts')
        .set('Cookie', ownerCookie)
        .send(workoutPayload());

      expect(response.status).toBe(201);

      expect(response.body).toMatchObject({
        title: 'E2E Upper Body',
        athleteId: ownerId,
        createdById: ownerId,
        status: 'PLANNED',
      });

      expect(response.body.exercises).toHaveLength(1);

      expect(response.body.exercises[0]).toMatchObject({
        exerciseId: globalExerciseId,
        exerciseNameSnapshot: 'E2E Workout Bench Press',
        exerciseTypeSnapshot: 'STRENGTH',
        sortOrder: 0,
      });

      expect(response.body.exercises[0].sets).toHaveLength(2);

      createdWorkoutId = response.body.id;
      firstSetId = response.body.exercises[0].sets[0].id;
      secondSetId = response.body.exercises[0].sets[1].id;
    });

    it('replays manual creation with the same key and returns only one workout', async () => {
      const key = randomUUID();
      const payload = workoutPayload();

      const [first, second] = await Promise.all([
        request(app!.getHttpServer())
          .post('/workouts')
          .set('Cookie', ownerCookie)
          .set('Idempotency-Key', key)
          .send(payload),
        request(app!.getHttpServer())
          .post('/workouts')
          .set('Cookie', ownerCookie)
          .set('Idempotency-Key', key)
          .send(payload),
      ]);

      expect([first.status, second.status]).toEqual([201, 201]);
      expect(second.body.id).toBe(first.body.id);

      const persisted = await prisma.workout.findMany({
        where: { athleteId: ownerId, idempotencyKey: key },
        select: { id: true, exercises: { select: { id: true } } },
      });
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.exercises).toHaveLength(1);
      expect(first.body).not.toHaveProperty('idempotencyKey');
      expect(first.body).not.toHaveProperty('idempotencyFingerprint');
    });

    it('serializes competing payloads for the same manual creation key', async () => {
      const key = randomUUID();
      const titles = ['Race Winner A', 'Race Winner B'];

      const [first, second] = await Promise.all(titles.map((title) =>
        request(app!.getHttpServer())
          .post('/workouts')
          .set('Cookie', ownerCookie)
          .set('Idempotency-Key', key)
          .send(workoutPayload(title)),
      ));

      expect([first.status, second.status].sort()).toEqual([201, 409]);
      const winner = first.status === 201 ? first : second;
      expect(titles).toContain(winner.body.title);

      const persisted = await prisma.workout.findMany({
        where: { athleteId: ownerId, idempotencyKey: key },
        select: { id: true, title: true },
      });
      expect(persisted).toEqual([{ id: winner.body.id, title: winner.body.title }]);

      const conflict = first.status === 409 ? first : second;
      expect(conflict.body.id).toBeUndefined();
    });

    it('replays the original workout with its current state after an edit', async () => {
      const key = randomUUID();
      const payload = workoutPayload('Original idempotent workout');
      const first = await request(app!.getHttpServer())
        .post('/workouts')
        .set('Cookie', ownerCookie)
        .set('Idempotency-Key', key)
        .send(payload);
      expect(first.status).toBe(201);

      const updated = await request(app!.getHttpServer())
        .patch(`/workouts/${first.body.id}`)
        .set('Cookie', ownerCookie)
        .send({ title: 'Edited after creation' });
      expect(updated.status).toBe(200);

      // The fingerprint belongs to the ORIGINAL creation request, but
      // replay returns the current persisted representation.
      const replay = await request(app!.getHttpServer())
        .post('/workouts')
        .set('Cookie', ownerCookie)
        .set('Idempotency-Key', key)
        .send(payload);
      expect(replay.status).toBe(201);
      expect(replay.body).toMatchObject({
        id: first.body.id,
        title: 'Edited after creation',
      });
      expect(await prisma.workout.count({
        where: { athleteId: ownerId, idempotencyKey: key },
      })).toBe(1);
    });

    it('allows simultaneous key reuse by different athletes without sharing workouts', async () => {
      const key = randomUUID();
      const payload = workoutPayload('Shared key, separate users');
      const [owner, other] = await Promise.all([
        request(app!.getHttpServer())
          .post('/workouts')
          .set('Cookie', ownerCookie)
          .set('Idempotency-Key', key)
          .send(payload),
        request(app!.getHttpServer())
          .post('/workouts')
          .set('Cookie', otherAthleteCookie)
          .set('Idempotency-Key', key)
          .send(payload),
      ]);

      expect([owner.status, other.status]).toEqual([201, 201]);
      expect(other.body.id).not.toBe(owner.body.id);
      expect(owner.body.athleteId).toBe(ownerId);
      expect(other.body.athleteId).not.toBe(ownerId);

      const persisted = await prisma.workout.findMany({
        where: { idempotencyKey: key },
        select: { id: true, athleteId: true },
      });
      expect(persisted).toHaveLength(2);
      expect(new Set(persisted.map((item) => item.athleteId)).size).toBe(2);
    });

    it('rejects reusing a manual creation key for a different body', async () => {
      const key = randomUUID();
      const first = await request(app!.getHttpServer())
        .post('/workouts')
        .set('Cookie', ownerCookie)
        .set('Idempotency-Key', key)
        .send(workoutPayload());

      const second = await request(app!.getHttpServer())
        .post('/workouts')
        .set('Cookie', ownerCookie)
        .set('Idempotency-Key', key)
        .send({ ...workoutPayload(), title: 'Another Workout' });

      expect(first.status).toBe(201);
      expect(second.status).toBe(409);
      expect(await prisma.workout.count({
        where: { athleteId: ownerId, idempotencyKey: key },
      })).toBe(1);
    });

    it('rejects a malformed idempotency header', async () => {
      const response = await request(app!.getHttpServer())
        .post('/workouts')
        .set('Cookie', ownerCookie)
        .set('Idempotency-Key', 'bad')
        .send(workoutPayload());

      expect(response.status).toBe(400);
    });

    it('scopes creation keys to the authenticated athlete', async () => {
      const key = randomUUID();
      const first = await request(app!.getHttpServer())
        .post('/workouts')
        .set('Cookie', ownerCookie)
        .set('Idempotency-Key', key)
        .send(workoutPayload());

      const second = await request(app!.getHttpServer())
        .post('/workouts')
        .set('Cookie', otherAthleteCookie)
        .set('Idempotency-Key', key)
        .send(workoutPayload());

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).not.toBe(first.body.id);
    });
  });

  describe('GET /workouts', () => {
    it('should return workouts belonging to the athlete', async () => {
      const response = await request(app!.getHttpServer())
        .get('/workouts')
        .set('Cookie', ownerCookie)
        .query({ status: 'PLANNED' });

      expect(response.status).toBe(200);

      const ids = response.body.data.map(
        (workout: { id: string }) => workout.id,
      );

      expect(ids).toContain(createdWorkoutId);
    });

    it('should not expose another athlete workouts', async () => {
      const response = await request(app!.getHttpServer())
        .get('/workouts')
        .set('Cookie', otherAthleteCookie);

      expect(response.status).toBe(200);
      expect(response.body.data).not.toContainEqual(
        expect.objectContaining({ id: createdWorkoutId }),
      );
      expect(response.body.data.every(
        (workout: { athleteId: string }) => workout.athleteId !== ownerId,
      )).toBe(true);
    });
  });

  describe('GET /workouts/:id', () => {
    it('should return workout details to its owner', async () => {
      const response = await request(app!.getHttpServer())
        .get(`/workouts/${createdWorkoutId}`)
        .set('Cookie', ownerCookie);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(createdWorkoutId);
    });

    it('should hide another athlete workout', async () => {
      const response = await request(app!.getHttpServer())
        .get(`/workouts/${createdWorkoutId}`)
        .set('Cookie', otherAthleteCookie);

      expect(response.status).toBe(404);
    });

    it('should reject an invalid UUID', async () => {
      const response = await request(app!.getHttpServer())
        .get('/workouts/not-a-valid-uuid')
        .set('Cookie', ownerCookie);

      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /workouts/:id', () => {
    it('should allow the owner to update a planned workout', async () => {
      const response = await request(app!.getHttpServer())
        .patch(`/workouts/${createdWorkoutId}`)
        .set('Cookie', ownerCookie)
        .send({
          title: 'Updated E2E Upper Body',
        });

      expect(response.status).toBe(200);
      expect(response.body.title).toBe('Updated E2E Upper Body');
    });

    it('should reject updates by another athlete', async () => {
      const response = await request(app!.getHttpServer())
        .patch(`/workouts/${createdWorkoutId}`)
        .set('Cookie', otherAthleteCookie)
        .send({
          title: 'Unauthorized Update',
        });

      expect(response.status).toBe(404);
    });
  });

  describe('Workout lifecycle', () => {
    it('should start a planned workout', async () => {
      const response = await request(app!.getHttpServer())
        .post(`/workouts/${createdWorkoutId}/start`)
        .set('Cookie', ownerCookie);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('IN_PROGRESS');
      expect(response.body.startedAt).toBeTruthy();
    });

    it('should reject completion while pending sets remain', async () => {
      const response = await request(app!.getHttpServer())
        .post(`/workouts/${createdWorkoutId}/complete`)
        .set('Cookie', ownerCookie);

      expect(response.status).toBe(400);
    });

    it('should record actual performance for a completed set', async () => {
      const response = await request(app!.getHttpServer())
        .patch(`/workouts/${createdWorkoutId}/sets/${firstSetId}`)
        .set('Cookie', ownerCookie)
        .send({
          status: 'COMPLETED',
          actualReps: 8,
          actualWeightKg: 60,
          rpe: 8,
          rir: 2,
        });

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        id: firstSetId,
        status: 'COMPLETED',
        actualReps: 8,
        actualWeightKg: '60',
        rpe: '8',
        rir: 2,
      });
    });

    it('should allow skipping a set', async () => {
      const response = await request(app!.getHttpServer())
        .patch(`/workouts/${createdWorkoutId}/sets/${secondSetId}`)
        .set('Cookie', ownerCookie)
        .send({
          status: 'SKIPPED',
          notes: 'Skipped during E2E test',
        });

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        id: secondSetId,
        status: 'SKIPPED',
      });
    });

    it('should complete the workout when all sets are processed', async () => {
      const response = await request(app!.getHttpServer())
        .post(`/workouts/${createdWorkoutId}/complete`)
        .set('Cookie', ownerCookie);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('COMPLETED');
      expect(response.body.completedAt).toBeTruthy();
    });

    it('should reject editing a completed workout', async () => {
      const response = await request(app!.getHttpServer())
        .patch(`/workouts/${createdWorkoutId}`)
        .set('Cookie', ownerCookie)
        .send({
          title: 'Should Not Be Updated',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /workouts/:id/cancel', () => {
    it('should cancel a planned workout', async () => {
      const workout = await createWorkout('E2E Workout To Cancel');

      const response = await request(app!.getHttpServer())
        .post(`/workouts/${workout.id}/cancel`)
        .set('Cookie', ownerCookie);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('CANCELLED');
    });
  });

  describe('POST /workouts/from-program', () => {
    const scheduledAt = '2030-01-15T10:00:00.000Z';

    const payload = () => ({
      assignmentId: programAssignmentId,
      programWorkoutId,
      scheduledAt,
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(app!.getHttpServer())
        .post('/workouts/from-program')
        .send(payload());

      expect(response.status).toBe(401);
    });

    it('should reject invalid UUIDs', async () => {
      const response = await request(app!.getHttpServer())
        .post('/workouts/from-program')
        .set('Cookie', ownerCookie)
        .send({
          ...payload(),
          assignmentId: 'invalid-uuid',
        });

      expect(response.status).toBe(400);
    });

    it('should create a workout from an active program assignment', async () => {
      const response = await request(app!.getHttpServer())
        .post('/workouts/from-program')
        .set('Cookie', ownerCookie)
        .send(payload());

      expect(response.status).toBe(201);

      expect(response.body).toMatchObject({
        title: 'E2E Program Workout',
        notes: 'Created from an assigned program',
        athleteId: ownerId,
        createdById: ownerId,
        status: 'PLANNED',
        scheduledAt,
        programAssignmentId,
        programWorkoutId,
        exercises: [
          {
            exerciseId: globalExerciseId,
            exerciseNameSnapshot: 'Program Bench Press Snapshot',
            exerciseTypeSnapshot: 'STRENGTH',
            sortOrder: 0,
            notes: 'Program exercise notes',
            sets: [
              {
                setNumber: 1,
                setType: 'WORKING',
                status: 'PENDING',
                plannedReps: 10,
                plannedWeightKg: '60',
                restSeconds: 90,
                targetRpe: '8',
                targetRir: 2,
                actualReps: null,
                completedAt: null,
              },
            ],
          },
        ],
      });
    });

    it('replays concurrent program creation with one key', async () => {
      const key = randomUUID();
      const [first, second] = await Promise.all([
        request(app!.getHttpServer())
          .post('/workouts/from-program')
          .set('Cookie', ownerCookie)
          .set('Idempotency-Key', key)
          .send(payload()),
        request(app!.getHttpServer())
          .post('/workouts/from-program')
          .set('Cookie', ownerCookie)
          .set('Idempotency-Key', key)
          .send(payload()),
      ]);

      expect([first.status, second.status]).toEqual([201, 201]);
      expect(second.body.id).toBe(first.body.id);
      expect(await prisma.workout.count({
        where: { athleteId: ownerId, idempotencyKey: key },
      })).toBe(1);
    });

    it('rejects reuse of a key across workout creation routes', async () => {
      const key = randomUUID();
      const program = await request(app!.getHttpServer())
        .post('/workouts/from-program')
        .set('Cookie', ownerCookie)
        .set('Idempotency-Key', key)
        .send(payload());

      const manual = await request(app!.getHttpServer())
        .post('/workouts')
        .set('Cookie', ownerCookie)
        .set('Idempotency-Key', key)
        .send(workoutPayload());

      expect(program.status).toBe(201);
      expect(manual.status).toBe(409);
    });

    it('should hide assignments belonging to another athlete', async () => {
      const response = await request(app!.getHttpServer())
        .post('/workouts/from-program')
        .set('Cookie', otherAthleteCookie)
        .send(payload());

      expect(response.status).toBe(404);
    });

    it('should reject a workout belonging to another program version', async () => {
      const response = await request(app!.getHttpServer())
        .post('/workouts/from-program')
        .set('Cookie', ownerCookie)
        .send({
          assignmentId: programAssignmentId,
          programWorkoutId: anotherVersionWorkoutId,
        });

      expect(response.status).toBe(404);
    });

    it('should return 404 for a nonexistent assignment', async () => {
      const response = await request(app!.getHttpServer())
        .post('/workouts/from-program')
        .set('Cookie', ownerCookie)
        .send({
          assignmentId: randomUUID(),
          programWorkoutId,
        });

      expect(response.status).toBe(404);
    });
  });

  describe('POST /training-programs/assignments/:assignmentId/complete', () => {
    it('should return 409 when a planned workout exists', async () => {
      const workoutResponse = await request(app!.getHttpServer())
        .post('/workouts/from-program')
        .set('Cookie', ownerCookie)
        .send({
          assignmentId: programAssignmentId,
          programWorkoutId,
        });

      expect(workoutResponse.status).toBe(201);
      expect(workoutResponse.body.status).toBe('PLANNED');

      const response = await request(app!.getHttpServer())
        .post(`/training-programs/assignments/${programAssignmentId}/complete`)
        .set('Cookie', ownerCookie);

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('Cannot complete assignment:');

      const assignment = await prisma.trainingProgramAssignment.findUnique({
        where: { id: programAssignmentId },
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

    it('should complete an assignment when all linked workouts are completed', async () => {
      const originalAssignment =
        await prisma.trainingProgramAssignment.findUniqueOrThrow({
          where: { id: programAssignmentId },
          select: {
            versionId: true,
            trainerAthleteId: true,
          },
        });

      const assignment = await prisma.trainingProgramAssignment.create({
        data: {
          versionId: anotherVersionId,
          trainerAthleteId: originalAssignment.trainerAthleteId,
          athleteId: ownerId,
          assignedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      assignmentIds.push(assignment.id);

      // Create a workout linked to this assignment.
      const workoutResponse = await request(app!.getHttpServer())
        .post('/workouts/from-program')
        .set('Cookie', ownerCookie)
        .send({
          assignmentId: assignment.id,
          programWorkoutId: anotherVersionWorkoutId,
        });

      expect(workoutResponse.status).toBe(201);
      expect(workoutResponse.body.status).toBe('PLANNED');

      // Prepare a completed workout for this scenario.
      await prisma.workout.update({
        where: { id: workoutResponse.body.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      // Complete the assignment through HTTP.
      const response = await request(app!.getHttpServer())
        .post(`/training-programs/assignments/${assignment.id}/complete`)
        .set('Cookie', ownerCookie);

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        id: assignment.id,
        status: 'COMPLETED',
      });

      expect(response.body.completedAt).toBeTruthy();

      const persistedAssignment =
        await prisma.trainingProgramAssignment.findUnique({
          where: { id: assignment.id },
          select: {
            status: true,
            completedAt: true,
          },
        });

      expect(persistedAssignment).toEqual({
        status: 'COMPLETED',
        completedAt: new Date(response.body.completedAt),
      });
    });

    it('should reject completing another athlete assignment', async () => {
      const response = await request(app!.getHttpServer())
        .post(`/training-programs/assignments/${programAssignmentId}/complete`)
        .set('Cookie', otherAthleteCookie);

      expect(response.status).toBe(404);

      const assignment = await prisma.trainingProgramAssignment.findUnique({
        where: { id: programAssignmentId },
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

    it('should reject assignment completion by a trainer', async () => {
      const trainer = await prisma.user.findUniqueOrThrow({
        where: { id: trainerId },
        select: { email: true },
      });

      const trainerCookie = await login(trainer.email);

      const response = await request(app!.getHttpServer())
        .post(`/training-programs/assignments/${programAssignmentId}/complete`)
        .set('Cookie', trainerCookie);

      expect(response.status).toBe(403);

      const assignment = await prisma.trainingProgramAssignment.findUnique({
        where: { id: programAssignmentId },
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

    it('should reject completing an already completed assignment', async () => {
      const originalAssignment =
        await prisma.trainingProgramAssignment.findUniqueOrThrow({
          where: { id: programAssignmentId },
          select: {
            versionId: true,
            trainerAthleteId: true,
          },
        });

      const assignment = await prisma.trainingProgramAssignment.create({
        data: {
          versionId: anotherVersionId,
          trainerAthleteId: originalAssignment.trainerAthleteId,
          athleteId: ownerId,
          assignedById: trainerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      assignmentIds.push(assignment.id);

      const endpoint = `/training-programs/assignments/${assignment.id}/complete`;

      // First completion succeeds.
      const firstResponse = await request(app!.getHttpServer())
        .post(endpoint)
        .set('Cookie', ownerCookie);

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.body.status).toBe('COMPLETED');

      const completedAt = firstResponse.body.completedAt;

      // Second completion must be rejected.
      const secondResponse = await request(app!.getHttpServer())
        .post(endpoint)
        .set('Cookie', ownerCookie);

      expect(secondResponse.status).toBe(409);

      expect(secondResponse.body.message).toBe(
        'Only active assignments can be completed.',
      );

      const persistedAssignment =
        await prisma.trainingProgramAssignment.findUnique({
          where: { id: assignment.id },
          select: {
            status: true,
            completedAt: true,
          },
        });

      expect(persistedAssignment).toEqual({
        status: 'COMPLETED',
        completedAt: new Date(completedAt),
      });
    });
  });

  it('should complete an active assignment without workouts', async () => {
    const originalAssignment =
      await prisma.trainingProgramAssignment.findUniqueOrThrow({
        where: { id: programAssignmentId },
        select: {
          versionId: true,
          trainerAthleteId: true,
        },
      });

    const assignment = await prisma.trainingProgramAssignment.create({
      data: {
        versionId: anotherVersionId,
        trainerAthleteId: originalAssignment.trainerAthleteId,
        athleteId: ownerId,
        assignedById: trainerId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    assignmentIds.push(assignment.id);

    const response = await request(app!.getHttpServer())
      .post(`/training-programs/assignments/${assignment.id}/complete`)
      .set('Cookie', ownerCookie);

    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      id: assignment.id,
      status: 'COMPLETED',
    });

    expect(response.body.completedAt).toBeTruthy();

    const persistedAssignment =
      await prisma.trainingProgramAssignment.findUnique({
        where: { id: assignment.id },
        select: {
          status: true,
          completedAt: true,
        },
      });

    expect(persistedAssignment).toEqual({
      status: 'COMPLETED',
      completedAt: new Date(response.body.completedAt),
    });
  });
});
