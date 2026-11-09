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
import { useTestDatabase } from './utility/test-db-helper.js';

describe('Exercises (HTTP + PostgreSQL)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  let passwordHasher: PasswordHasher;

  let ownerId: string;

  let ownerCookie: string;
  let otherAthleteCookie: string;

  let globalExerciseId: string;
  let privateExerciseId: string;
  let createdExerciseId: string;

  const userIds: string[] = [];
  const exerciseIds: string[] = [];

  const password = 'StrongPassword123!';

  const ownerEmail = `exercise-owner-${randomUUID()}@example.com`;
  const otherEmail = `exercise-other-${randomUUID()}@example.com`;

  const globalSlug = `e2e-global-${randomUUID()}`;
  const globalName = 'E2E Global Bench Press';

  const privateName = 'E2E Private Exercise';

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

    // Create test users.
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

    userIds.push(otherAthlete.id);

    // Prepare dictionary records.
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

    // Create a global exercise.
    const globalExercise = await prisma.exercise.create({
      data: {
        slug: globalSlug,
        name: globalName,
        source: 'GLOBAL',
        exerciseType: 'STRENGTH',

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

    globalExerciseId = globalExercise.id;
    exerciseIds.push(globalExercise.id);

    // Create another athlete's private exercise.
    const privateExercise = await prisma.exercise.create({
      data: {
        name: privateName,
        source: 'ATHLETE_CUSTOM',
        visibility: 'PRIVATE',
        exerciseType: 'STRENGTH',

        createdBy: {
          connect: { id: otherAthlete.id },
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
      },
      select: { id: true },
    });

    privateExerciseId = privateExercise.id;
    exerciseIds.push(privateExercise.id);

    // Authenticate both athletes.
    ownerCookie = await login(ownerEmail);
    otherAthleteCookie = await login(otherEmail);
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma) {
        // Remove workouts referencing these exercises before cleaning sources.
        if (userIds.length > 0) {
          await prisma.workout.deleteMany({
            where: { athleteId: { in: userIds } },
          });
        }
        // Remove exercises before removing their owners.
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

  describe('GET /exercises', () => {
    it('should return global exercises to guests', async () => {
      const response = await request(app!.getHttpServer())
        .get('/exercises')
        .query({
          search: globalName,
        });

      expect(response.status).toBe(200);

      const ids = response.body.data.map(
        (exercise: { id: string }) => exercise.id,
      );

      expect(ids).toContain(globalExerciseId);
      expect(ids).not.toContain(privateExerciseId);
    });
  });

  describe('GET /exercises/:id', () => {
    it('should return a global exercise to guests', async () => {
      const response = await request(app!.getHttpServer()).get(
        `/exercises/${globalExerciseId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(globalExerciseId);
    });

    it('should hide private exercises from guests', async () => {
      const response = await request(app!.getHttpServer()).get(
        `/exercises/${privateExerciseId}`,
      );

      expect(response.status).toBe(404);
    });

    it('should hide another athlete private exercise', async () => {
      const response = await request(app!.getHttpServer())
        .get(`/exercises/${privateExerciseId}`)
        .set('Cookie', ownerCookie);

      expect(response.status).toBe(404);
    });

    it('should reject an invalid UUID', async () => {
      const response = await request(app!.getHttpServer()).get(
        '/exercises/not-a-valid-uuid',
      );

      expect(response.status).toBe(400);
    });
  });

  describe('PATCH/DELETE /exercises/:id anti-enumeration', () => {
    it.each(['patch', 'delete'] as const)(
      'returns indistinguishable 404 error details for foreign private and unknown ids on %s',
      async (method) => {
        const missingId = randomUUID();
        const perform = (id: string) => method === 'patch'
          ? request(app!.getHttpServer())
              .patch(`/exercises/${id}`)
              .set('Cookie', ownerCookie)
              .send({ name: 'Unauthorized change' })
          : request(app!.getHttpServer())
              .delete(`/exercises/${id}`)
              .set('Cookie', ownerCookie);

        const [foreign, missing] = await Promise.all([
          perform(privateExerciseId),
          perform(missingId),
        ]);
        for (const response of [foreign, missing]) {
          expect(response.status).toBe(404);
          expect(response.body).toMatchObject({
            statusCode: 404,
            code: 'NOT_FOUND',
            message: 'Exercise not found',
          });
          expect(response.headers['cache-control']).toBe('no-store');
          expect(response.headers['x-request-id']).toBe(response.body.requestId);
          expect(JSON.stringify(response.body)).not.toContain(privateName);
        }
        expect(foreign.body.code).toBe(missing.body.code);
        expect(foreign.body.message).toBe(missing.body.message);

        const preserved = await prisma.exercise.findUniqueOrThrow({
          where: { id: privateExerciseId },
          select: { name: true, isArchived: true },
        });
        expect(preserved).toEqual({ name: privateName, isArchived: false });
      },
    );

    it.each(['patch', 'delete'] as const)(
      'keeps global exercises visible but rejects non-admin management with 403 on %s',
      async (method) => {
        const response = method === 'patch'
          ? await request(app!.getHttpServer())
              .patch(`/exercises/${globalExerciseId}`)
              .set('Cookie', ownerCookie)
              .send({ name: 'Unauthorized global update' })
          : await request(app!.getHttpServer())
              .delete(`/exercises/${globalExerciseId}`)
              .set('Cookie', ownerCookie);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('FORBIDDEN');
        expect(response.headers['cache-control']).toBe('no-store');
      },
    );
  });

  describe('POST /exercises', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await request(app!.getHttpServer())
        .post('/exercises')
        .send({
          name: 'Unauthorized Exercise',
          muscleGroups: [{ slug: 'chest', role: 'PRIMARY' }],
          equipment: [],
        });

      expect(response.status).toBe(401);
    });

    it('should reject attempts to override protected fields', async () => {
      const response = await request(app!.getHttpServer())
        .post('/exercises')
        .set('Cookie', ownerCookie)
        .send({
          name: 'Malicious Exercise',
          source: 'GLOBAL',
          createdById: 'another-user',
          isArchived: false,
          muscleGroups: [{ slug: 'chest', role: 'PRIMARY' }],
          equipment: [],
        });

      expect(response.status).toBe(400);
    });

    it('should create a private athlete exercise', async () => {
      const response = await request(app!.getHttpServer())
        .post('/exercises')
        .set('Cookie', ownerCookie)
        .send({
          name: 'My Custom Bench Press',
          description: 'My personal variation',
          exerciseType: 'STRENGTH',
          visibility: 'PRIVATE',
          muscleGroups: [
            { slug: 'chest', role: 'PRIMARY' },
            { slug: 'triceps', role: 'SECONDARY' },
          ],
          equipment: ['barbell'],
        });

      expect(response.status).toBe(201);

      expect(response.body).toMatchObject({
        name: 'My Custom Bench Press',
        source: 'ATHLETE_CUSTOM',
        visibility: 'PRIVATE',
        createdById: ownerId,
        isArchived: false,
      });

      createdExerciseId = response.body.id;
      exerciseIds.push(createdExerciseId);
    });
  });

  describe('PATCH /exercises/:id', () => {
    it('should allow the owner to update their exercise', async () => {
      const response = await request(app!.getHttpServer())
        .patch(`/exercises/${createdExerciseId}`)
        .set('Cookie', ownerCookie)
        .send({
          name: 'Updated Custom Bench Press',
        });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Updated Custom Bench Press');
    });

    it('should reject updates by another athlete', async () => {
      const response = await request(app!.getHttpServer())
        .patch(`/exercises/${createdExerciseId}`)
        .set('Cookie', otherAthleteCookie)
        .send({
          name: 'Unauthorized Update',
        });

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Exercise not found',
      });
    });
  });

  describe('DELETE /exercises/:id', () => {
    it('should archive an exercise owned by the athlete', async () => {
      const response = await request(app!.getHttpServer())
        .delete(`/exercises/${createdExerciseId}`)
        .set('Cookie', ownerCookie);

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        id: createdExerciseId,
        isArchived: true,
      });
    });

    it('should not return archived exercises', async () => {
      const response = await request(app!.getHttpServer())
        .get(`/exercises/${createdExerciseId}`)
        .set('Cookie', ownerCookie);

      expect(response.status).toBe(404);
    });
  });

  describe('Workout start after exercise archive', () => {
    it('returns the existing 409 contract and preserves a planned workout snapshot', async () => {
      const source = await request(app!.getHttpServer())
        .post('/exercises')
        .set('Cookie', ownerCookie)
        .send({
          name: `Archive start regression ${randomUUID()}`,
          exerciseType: 'STRENGTH',
          visibility: 'PRIVATE',
          muscleGroups: [{ slug: 'chest', role: 'PRIMARY' }],
          equipment: [],
        });
      expect(source.status).toBe(201);
      const sourceId = source.body.id as string;
      exerciseIds.push(sourceId);

      const created = await request(app!.getHttpServer())
        .post('/workouts')
        .set('Cookie', ownerCookie)
        .send({
          title: 'Planned workout with soon-archived exercise',
          exercises: [{
            exerciseId: sourceId,
            sets: [{ plannedReps: 8 }],
          }],
        });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('PLANNED');
      const workoutId = created.body.id as string;
      expect(created.body.exercises[0].exerciseId).toBe(sourceId);

      const archived = await request(app!.getHttpServer())
        .delete(`/exercises/${sourceId}`)
        .set('Cookie', ownerCookie);
      expect(archived.status).toBe(200);
      expect(archived.body.isArchived).toBe(true);

      const start = await request(app!.getHttpServer())
        .post(`/workouts/${workoutId}/start`)
        .set('Cookie', ownerCookie);
      expect(start.status).toBe(409);
      expect(start.body.code).toBe('CONFLICT');
      expect(start.headers['cache-control']).toBe('no-store');

      const history = await request(app!.getHttpServer())
        .get(`/workouts/${workoutId}`)
        .set('Cookie', ownerCookie);
      expect(history.status).toBe(200);
      expect(history.body).toMatchObject({
        status: 'PLANNED',
        startedAt: null,
        exercises: [{
          exerciseId: sourceId,
          exerciseNameSnapshot: source.body.name,
        }],
      });
    });
  });
});
