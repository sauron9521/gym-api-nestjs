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
import { PrismaService } from '../src/infra/database/index.js';
import { ExercisesService } from '../src/modules/exercises/services/exercises.service.js';
import { useTestDatabase } from './utility/test-db-helper.js';

describe('Trainer-athlete exercise copies (HTTP + PostgreSQL)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  let passwordHasher: PasswordHasher;

  let trainerId: string;
  let athleteId: string;

  let trainerCookie: string;
  let athleteCookie: string;

  let usedExerciseId: string;
  let assignedExerciseId: string;
  let unusedExerciseId: string;
  let athleteSharedExerciseId: string;

  let workoutId: string;

  const sourceExerciseIds: string[] = [];

  const password = 'StrongPassword123!';

  const trainerEmail = `copy-trainer-${randomUUID()}@example.com`;
  const athleteEmail = `copy-athlete-${randomUUID()}@example.com`;

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

  beforeAll(async () => {
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

    const trainer = await prisma.user.create({
      data: {
        email: trainerEmail,
        passwordHash,
        role: 'TRAINER',
      },
      select: { id: true },
    });

    trainerId = trainer.id;

    const athlete = await prisma.user.create({
      data: {
        email: athleteEmail,
        passwordHash,
        role: 'ATHLETE',
      },
      select: { id: true },
    });

    athleteId = athlete.id;

    await prisma.muscleGroup.upsert({
      where: { slug: 'chest' },
      update: {},
      create: {
        name: 'Chest',
        slug: 'chest',
      },
    });

    await prisma.equipment.upsert({
      where: { slug: 'barbell' },
      update: {},
      create: {
        name: 'Barbell',
        slug: 'barbell',
      },
    });

    async function createTrainerExercise(name: string) {
      const exercise = await prisma.exercise.create({
        data: {
          name,
          source: 'TRAINER_CUSTOM',
          exerciseType: 'STRENGTH',

          createdBy: {
            connect: { id: trainerId },
          },

          muscleGroups: {
            create: [
              {
                role: 'PRIMARY',
                muscleGroup: {
                  connect: { slug: 'chest' },
                },
              },
            ],
          },

          equipment: {
            create: [
              {
                equipment: {
                  connect: { slug: 'barbell' },
                },
              },
            ],
          },
        },
        select: { id: true },
      });

      sourceExerciseIds.push(exercise.id);

      return exercise.id;
    }

    usedExerciseId = await createTrainerExercise('E2E Trainer Exercise Used');

    assignedExerciseId = await createTrainerExercise(
      'E2E Trainer Exercise Assigned',
    );

    unusedExerciseId = await createTrainerExercise(
      'E2E Trainer Exercise Unused',
    );

    const athleteExercise = await prisma.exercise.create({
      data: {
        name: 'E2E Athlete Shared Exercise',
        source: 'ATHLETE_CUSTOM',
        visibility: 'SELECTED_TRAINERS',
        exerciseType: 'STRENGTH',

        createdBy: {
          connect: { id: athleteId },
        },
      },
      select: { id: true },
    });

    athleteSharedExerciseId = athleteExercise.id;

    await prisma.exerciseTrainerAccess.create({
      data: {
        exerciseId: athleteSharedExerciseId,
        trainerId,
      },
    });

    trainerCookie = await login(trainerEmail);
    athleteCookie = await login(athleteEmail);
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma && trainerId && athleteId) {
        await prisma.workout.deleteMany({
          where: {
            athleteId,
          },
        });

        await prisma.trainerAthlete.deleteMany({
          where: {
            OR: [{ trainerId }, { athleteId }],
          },
        });

        await prisma.exerciseAthleteAssignment.deleteMany({
          where: {
            OR: [{ athleteId }, { assignedById: trainerId }],
          },
        });

        await prisma.exerciseTrainerAccess.deleteMany({
          where: {
            trainerId,
          },
        });

        // Delete copies before their originals because copiedFrom
        // uses onDelete: Restrict.
        if (sourceExerciseIds.length > 0) {
          await prisma.exercise.deleteMany({
            where: {
              createdById: athleteId,
              copiedFromExerciseId: {
                in: sourceExerciseIds,
              },
            },
          });
        }

        await prisma.exercise.deleteMany({
          where: {
            id: {
              in: [...sourceExerciseIds, athleteSharedExerciseId],
            },
          },
        });

        await prisma.user.deleteMany({
          where: {
            id: {
              in: [trainerId, athleteId],
            },
          },
        });
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('should copy used and assigned trainer exercises when the relationship ends', async () => {
    // 1. Trainer initiates a relationship.
    const createRelationship = await request(app!.getHttpServer())
      .post('/trainer-athletes')
      .set('Cookie', trainerCookie)
      .send({
        userId: athleteId,
      });

    expect(createRelationship.status).toBe(201);

    const relationshipId = createRelationship.body.id;

    // 2. Athlete accepts it.
    const acceptResponse = await request(app!.getHttpServer())
      .post(`/trainer-athletes/${relationshipId}/accept`)
      .set('Cookie', athleteCookie);

    expect(acceptResponse.status).toBe(200);
    expect(acceptResponse.body.status).toBe('ACTIVE');

    // Both directions are accessible during an ACTIVE collaboration.
    const trainerShared = await request(app!.getHttpServer())
      .get(`/exercises/${athleteSharedExerciseId}`)
      .set('Cookie', trainerCookie);
    expect(trainerShared.status).toBe(200);
    expect(trainerShared.body.id).toBe(athleteSharedExerciseId);

    const athleteBorrowed = await request(app!.getHttpServer())
      .get(`/exercises/${usedExerciseId}`)
      .set('Cookie', athleteCookie);
    expect(athleteBorrowed.status).toBe(200);
    expect(athleteBorrowed.body.id).toBe(usedExerciseId);

    // Deliberately keep the old ACTIVE context to simulate a concurrent
    // termination between context lookup and the exercise SQL query.
    const staleAthleteContext = {
      activeTrainerIds: [trainerId],
      activeAthleteIds: [],
    };
    const staleTrainerContext = {
      activeTrainerIds: [],
      activeAthleteIds: [athleteId],
    };
    const exerciseService = app!.get(ExercisesService);
    await expect(exerciseService.findAvailableForWorkout(
      { id: athleteId, role: 'ATHLETE' },
      [usedExerciseId],
      staleAthleteContext,
    )).resolves.toEqual([expect.objectContaining({ id: usedExerciseId })]);
    await expect(exerciseService.findOne(
      athleteSharedExerciseId,
      { id: trainerId, role: 'TRAINER' },
      staleTrainerContext,
    )).resolves.toMatchObject({ id: athleteSharedExerciseId });

    // 3. Trainer assigns an exercise to the athlete.
    await prisma.exerciseAthleteAssignment.create({
      data: {
        exerciseId: assignedExerciseId,
        athleteId,
        assignedById: trainerId,
      },
    });

    // 4. Athlete uses another trainer exercise in a workout.
    const workoutResponse = await request(app!.getHttpServer())
      .post('/workouts')
      .set('Cookie', athleteCookie)
      .send({
        title: 'E2E Trainer Exercise Workout',
        exercises: [
          {
            exerciseId: usedExerciseId,
            sets: [
              {
                plannedReps: 10,
                plannedWeightKg: 50,
              },
            ],
          },
        ],
      });

    expect(workoutResponse.status).toBe(201);

    workoutId = workoutResponse.body.id;

    expect(workoutResponse.body.exercises[0]).toMatchObject({
      exerciseId: usedExerciseId,
      exerciseNameSnapshot: 'E2E Trainer Exercise Used',
    });

    // 5. Start the workout so its exercise counts as used.
    const startResponse = await request(app!.getHttpServer())
      .post(`/workouts/${workoutId}/start`)
      .set('Cookie', athleteCookie);

    expect(startResponse.status).toBe(200);
    expect(startResponse.body.status).toBe('IN_PROGRESS');

    // A second trainer exercise was scheduled, but not started. The
    // athlete must not be able to start this planned workout after revocation.
    const pendingWorkoutResponse = await request(app!.getHttpServer())
      .post('/workouts')
      .set('Cookie', athleteCookie)
      .send({
        title: 'Planned trainer workout before termination',
        exercises: [{ exerciseId: unusedExerciseId, sets: [{ plannedReps: 8 }] }],
      });
    expect(pendingWorkoutResponse.status).toBe(201);
    const pendingWorkoutId = pendingWorkoutResponse.body.id as string;
    expect(pendingWorkoutResponse.body.status).toBe('PLANNED');

    // 6. End the relationship.
    const terminateResponse = await request(app!.getHttpServer())
      .post(`/trainer-athletes/${relationshipId}/terminate`)
      .set('Cookie', athleteCookie)
      .send({
        reason: 'E2E relationship termination',
      });

    expect(terminateResponse.status).toBe(200);

    expect(terminateResponse.body).toMatchObject({
      id: relationshipId,
      status: 'TERMINATED',
      endedById: athleteId,
      endReason: 'E2E relationship termination',
    });

    // 7. Read all personal copies created from these trainer exercises.
    const copies = await prisma.exercise.findMany({
      where: {
        createdById: athleteId,
        copiedFromExerciseId: {
          in: sourceExerciseIds,
        },
      },
      include: {
        muscleGroups: {
          include: {
            muscleGroup: true,
          },
        },
        equipment: {
          include: {
            equipment: true,
          },
        },
      },
    });

    const copiesBySource = new Map(
      copies.map((exercise) => [exercise.copiedFromExerciseId, exercise]),
    );

    // Used exercise must be copied.
    const usedCopy = copiesBySource.get(usedExerciseId);

    expect(usedCopy).toBeTruthy();

    expect(usedCopy).toMatchObject({
      name: 'E2E Trainer Exercise Used',
      source: 'ATHLETE_CUSTOM',
      visibility: 'PRIVATE',
      createdById: athleteId,
      isArchived: false,
    });

    expect(
      usedCopy!.muscleGroups.map((item) => item.muscleGroup.slug),
    ).toContain('chest');

    expect(usedCopy!.equipment.map((item) => item.equipment.slug)).toContain(
      'barbell',
    );

    // Assigned exercise must be copied, even without a workout.
    expect(copiesBySource.has(assignedExerciseId)).toBe(true);

    // Unused and unassigned exercise must not be copied.
    expect(copiesBySource.has(unusedExerciseId)).toBe(false);

    // 8. Verify assignment was revoked.
    const assignment = await prisma.exerciseAthleteAssignment.findUnique({
      where: {
        exerciseId_athleteId: {
          exerciseId: assignedExerciseId,
          athleteId,
        },
      },
    });

    expect(assignment?.revokedAt).toBeTruthy();

    // 9. Verify trainer access to athlete's shared exercise was revoked.
    const trainerAccess = await prisma.exerciseTrainerAccess.findUnique({
      where: {
        exerciseId_trainerId: {
          exerciseId: athleteSharedExerciseId,
          trainerId,
        },
      },
    });

    expect(trainerAccess?.revokedAt).toBeTruthy();

    // A stale, once-active context cannot bypass the relationship check
    // after termination. Verify directly at the service boundary to simulate
    // a request racing the state change, in addition to real HTTP calls.
    await expect(exerciseService.findAvailableForWorkout(
      { id: athleteId, role: 'ATHLETE' },
      [usedExerciseId],
      staleAthleteContext,
    )).rejects.toMatchObject({ status: 400 });
    await expect(exerciseService.findOne(
      athleteSharedExerciseId,
      { id: trainerId, role: 'TRAINER' },
      staleTrainerContext,
    )).rejects.toMatchObject({ status: 404 });

    const trainerCannotRead = await request(app!.getHttpServer())
      .get(`/exercises/${athleteSharedExerciseId}`)
      .set('Cookie', trainerCookie);
    expect(trainerCannotRead.status).toBe(404);
    expect(trainerCannotRead.headers['cache-control']).toBe('no-store');

    const trainerCannotList = await request(app!.getHttpServer())
      .get('/exercises')
      .set('Cookie', trainerCookie)
      .query({ search: 'E2E Athlete Shared Exercise' });
    expect(trainerCannotList.status).toBe(200);
    expect(trainerCannotList.body.data).toEqual([]);

    const athleteCannotReadAssigned = await request(app!.getHttpServer())
      .get(`/exercises/${assignedExerciseId}`)
      .set('Cookie', athleteCookie);
    expect(athleteCannotReadAssigned.status).toBe(404);

    const deniedWorkout = await request(app!.getHttpServer())
      .post('/workouts')
      .set('Cookie', athleteCookie)
      .send({
        title: 'Cannot reuse revoked trainer original',
        exercises: [{ exerciseId: usedExerciseId, sets: [{ plannedReps: 8 }] }],
      });
    expect(deniedWorkout.status).toBe(400);
    expect(deniedWorkout.body.message).toBe('One or more exercises are not available');
    expect(deniedWorkout.headers['cache-control']).toBe('no-store');

    const deniedStart = await request(app!.getHttpServer())
      .post(`/workouts/${pendingWorkoutId}/start`)
      .set('Cookie', athleteCookie);
    expect(deniedStart.status).toBe(409);
    expect(deniedStart.body.code).toBe('CONFLICT');
    expect(deniedStart.headers['cache-control']).toBe('no-store');

    const persistedPending = await prisma.workout.findUniqueOrThrow({
      where: { id: pendingWorkoutId },
      select: {
        status: true,
        startedAt: true,
        exercises: { select: { exerciseId: true, exerciseNameSnapshot: true } },
      },
    });
    expect(persistedPending).toMatchObject({
      status: 'PLANNED',
      startedAt: null,
      exercises: [{
        exerciseId: unusedExerciseId,
        exerciseNameSnapshot: 'E2E Trainer Exercise Unused',
      }],
    });

    // 10. Trainer exercise is no longer visible to the athlete.
    const originalExerciseResponse = await request(app!.getHttpServer())
      .get(`/exercises/${usedExerciseId}`)
      .set('Cookie', athleteCookie);

    expect(originalExerciseResponse.status).toBe(404);

    // But the athlete's private copy remains visible.
    const copyResponse = await request(app!.getHttpServer())
      .get(`/exercises/${usedCopy!.id}`)
      .set('Cookie', athleteCookie);

    expect(copyResponse.status).toBe(200);
    expect(copyResponse.body.id).toBe(usedCopy!.id);

    const formerTrainerCannotReadCopy = await request(app!.getHttpServer())
      .get(`/exercises/${usedCopy!.id}`)
      .set('Cookie', trainerCookie);
    expect(formerTrainerCannotReadCopy.status).toBe(404);

    // 11. The old workout still references the original exercise.
    const oldWorkoutExercise = await prisma.workoutExercise.findFirst({
      where: {
        workoutId,
        exerciseId: usedExerciseId,
      },
    });

    expect(oldWorkoutExercise).toBeTruthy();

    expect(oldWorkoutExercise).toMatchObject({
      exerciseId: usedExerciseId,
      exerciseNameSnapshot: 'E2E Trainer Exercise Used',
      exerciseTypeSnapshot: 'STRENGTH',
    });

    // 12. The athlete can use the private copy in a new workout.
    const newWorkoutResponse = await request(app!.getHttpServer())
      .post('/workouts')
      .set('Cookie', athleteCookie)
      .send({
        title: 'E2E Workout With Personal Copy',
        exercises: [
          {
            exerciseId: usedCopy!.id,
            sets: [{ plannedReps: 8 }],
          },
        ],
      });

    expect(newWorkoutResponse.status).toBe(201);
  });
});
