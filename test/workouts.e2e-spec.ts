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
      .overrideGuard(ThrottlerGuard)
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
});
