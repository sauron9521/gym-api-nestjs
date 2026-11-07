import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { StandardSchemaValidationPipe, ValidationPipe } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';
import { PasswordHasher } from '@nestjs/authentication';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';

import request from 'supertest';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/index.js';
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
      expect(response.body.data).toEqual([]);
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
