import { randomUUID } from 'node:crypto';

import { PasswordHasher } from '@nestjs/authentication';
import { StandardSchemaValidationPipe, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/database/index.js';
import { useTestDatabase } from './utility/test-db-helper.js';

describe('Workout Analytics (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let athleteId: string;
  let anotherAthleteId: string;
  let trainerId: string;
  let benchId: string;
  let cardioId: string;
  let foreignExerciseId: string;
  let athleteCookie: string;
  let otherCookie: string;
  let trainerCookie: string;

  const password = 'StrongPassword123!';
  const unique = randomUUID();
  const emails = {
    owner: `analytics-owner-${unique}@example.com`,
    other: `analytics-other-${unique}@example.com`,
    trainer: `analytics-trainer-${unique}@example.com`,
  };

  function utcDate(daysAgo: number, hour: number): Date {
    const date = new Date();
    date.setUTCHours(hour, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - daysAgo);
    return date;
  }

  async function login(email: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const cookies: string[] = res.headers['set-cookie'] ?? [];
    const cookie = cookies.map((value) => value.split(';')[0] ?? '')
      .find((value) => value.startsWith('__Host-sid='));
    if (!cookie) throw new Error('Missing test session');
    return cookie;
  }

  type SetInput = {
    status: 'COMPLETED' | 'SKIPPED' | 'PENDING';
    actualReps?: number;
    actualWeightKg?: number;
    actualDurationSeconds?: number;
  };

  async function workout(
    userId: string,
    at: Date,
    status: 'COMPLETED' | 'PLANNED' | 'CANCELLED',
    blocks: Array<{
      exerciseId: string;
      name: string;
      type: 'STRENGTH' | 'CARDIO';
      sets: SetInput[];
    }>,
  ) {
    const saved = await prisma.workout.create({
      data: {
        title: 'Workout analytics fixture',
        athleteId: userId,
        createdById: userId,
        status,
        ...(status === 'COMPLETED' ? { completedAt: at, startedAt: at } : {}),
      },
    });

    for (let position = 0; position < blocks.length; position++) {
      const block = blocks[position]!;
      const exercise = await prisma.workoutExercise.create({
        data: {
          workoutId: saved.id,
          exerciseId: block.exerciseId,
          exerciseNameSnapshot: block.name,
          exerciseTypeSnapshot: block.type,
          sortOrder: position,
        },
      });
      for (let index = 0; index < block.sets.length; index++) {
        const set = block.sets[index]!;
        await prisma.workoutSet.create({
          data: {
            workoutExerciseId: exercise.id,
            setNumber: index + 1,
            setType: 'WORKING',
            status: set.status,
            actualReps: set.actualReps,
            actualWeightKg: set.actualWeightKg,
            actualDurationSeconds: set.actualDurationSeconds,
            completedAt: set.status === 'COMPLETED' ? at : null,
          },
        });
      }
    }
  }

  beforeAll(async () => {
    useTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true, transform: true, forbidNonWhitelisted: true,
      }),
      new StandardSchemaValidationPipe(),
    );
    await app.init();

    prisma = app.get(PrismaService);
    const passwordHash = await app.get(PasswordHasher).hash(password);
    const athlete = await prisma.user.create({
      data: { email: emails.owner, passwordHash, role: 'ATHLETE' },
      select: { id: true },
    });
    const another = await prisma.user.create({
      data: { email: emails.other, passwordHash, role: 'ATHLETE' },
      select: { id: true },
    });
    const trainer = await prisma.user.create({
      data: { email: emails.trainer, passwordHash, role: 'TRAINER' },
      select: { id: true },
    });
    athleteId = athlete.id;
    anotherAthleteId = another.id;
    trainerId = trainer.id;

    const bench = await prisma.exercise.create({
      data: {
        name: 'Analytics Bench Press', source: 'GLOBAL',
        exerciseType: 'STRENGTH',
      },
    });
    const cardio = await prisma.exercise.create({
      data: {
        name: 'Analytics Running', source: 'GLOBAL',
        exerciseType: 'CARDIO',
      },
    });
    const foreignExercise = await prisma.exercise.create({
      data: {
        name: 'Other Athlete Only', source: 'GLOBAL',
        exerciseType: 'STRENGTH',
      },
    });
    benchId = bench.id;
    cardioId = cardio.id;
    foreignExerciseId = foreignExercise.id;

    await workout(athleteId, utcDate(2, 10), 'COMPLETED', [
      {
        exerciseId: benchId, name: 'Historical Bench',
        type: 'STRENGTH',
        sets: [
          { status: 'COMPLETED', actualReps: 10, actualWeightKg: 60 },
          { status: 'SKIPPED', actualReps: 9, actualWeightKg: 200 },
        ],
      },
      {
        exerciseId: cardioId, name: 'Historical Running',
        type: 'CARDIO',
        sets: [
          { status: 'COMPLETED', actualReps: 20,
            actualWeightKg: 100, actualDurationSeconds: 120 },
        ],
      },
    ]);
    await workout(athleteId, utcDate(2, 15), 'COMPLETED', [
      {
        exerciseId: benchId, name: 'Historical Bench',
        type: 'STRENGTH',
        sets: [{ status: 'COMPLETED', actualReps: 8, actualWeightKg: 60.5 }],
      },
    ]);
    await workout(athleteId, utcDate(1, 11), 'COMPLETED', [
      {
        exerciseId: benchId, name: 'Bench Press Updated Snapshot',
        type: 'STRENGTH',
        sets: [{ status: 'COMPLETED', actualReps: 5, actualWeightKg: 70 }],
      },
    ]);
    await workout(athleteId, utcDate(10, 12), 'COMPLETED', [
      {
        exerciseId: benchId, name: 'Old Bench',
        type: 'STRENGTH',
        sets: [{ status: 'COMPLETED', actualReps: 10, actualWeightKg: 50 }],
      },
    ]);
    await workout(athleteId, utcDate(1, 12), 'PLANNED', [
      {
        exerciseId: benchId, name: 'Planned Bench',
        type: 'STRENGTH',
        sets: [{ status: 'COMPLETED', actualReps: 20, actualWeightKg: 200 }],
      },
    ]);
    await workout(athleteId, utcDate(1, 13), 'CANCELLED', [
      {
        exerciseId: benchId, name: 'Cancelled Bench',
        type: 'STRENGTH',
        sets: [{ status: 'COMPLETED', actualReps: 20, actualWeightKg: 200 }],
      },
    ]);
    await workout(anotherAthleteId, utcDate(1, 12), 'COMPLETED', [
      {
        exerciseId: foreignExerciseId, name: 'Other Athlete Only',
        type: 'STRENGTH',
        sets: [{ status: 'COMPLETED', actualReps: 10, actualWeightKg: 100 }],
      },
    ]);

    athleteCookie = await login(emails.owner);
    otherCookie = await login(emails.other);
    trainerCookie = await login(emails.trainer);
  }, 40_000);

  afterAll(async () => {
    try {
      if (prisma) {
        const userIds = [athleteId, anotherAthleteId, trainerId].filter(Boolean);
        await prisma.workout.deleteMany({
          where: { athleteId: { in: userIds } },
        });
        await prisma.exercise.deleteMany({
          where: { id: { in: [benchId, cardioId, foreignExerciseId].filter(Boolean) } },
        });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('requires authentication and athlete role', async () => {
    await request(app.getHttpServer())
      .get('/workout-analytics/summary').expect(401);
    await request(app.getHttpServer())
      .get('/workout-analytics/summary')
      .set('Cookie', trainerCookie).expect(403);
    await request(app.getHttpServer())
      .get(`/workout-analytics/exercises/${benchId}`)
      .set('Cookie', trainerCookie).expect(403);
  });

  it('summarizes only completed athlete workouts and actual strength volume', async () => {
    const res = await request(app.getHttpServer())
      .get('/workout-analytics/summary')
      .set('Cookie', athleteCookie)
      .query({ range: '7d' })
      .expect(200);

    expect(res.body).toMatchObject({
      range: '7d',
      workoutCount: 3,
      activeDays: 2,
      completedSets: 4,
      strengthVolumeKg: 1434,
    });
    expect(res.body.daily).toHaveLength(2);
    expect(res.body.daily.map((row: { workoutCount: number }) => row.workoutCount))
      .toEqual([2, 1]);
    expect(res.body).not.toHaveProperty('athleteId');
  });

  it('tracks exercise actual reps, snapshots and heaviest completed strength set', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workout-analytics/exercises/${benchId}`)
      .set('Cookie', athleteCookie)
      .query({ range: '7d' })
      .expect(200);

    expect(res.body).toMatchObject({
      exerciseId: benchId,
      name: 'Bench Press Updated Snapshot',
      workoutCount: 3,
      completedSets: 3,
      strengthReps: 23,
      strengthVolumeKg: 1434,
      bestWeightKg: 70,
    });
    expect(res.body.daily).toHaveLength(2);
  });

  it('does not leak another athlete exercise history or totals', async () => {
    const foreign = await request(app.getHttpServer())
      .get(`/workout-analytics/exercises/${foreignExerciseId}`)
      .set('Cookie', athleteCookie)
      .expect(200);
    expect(foreign.body).toMatchObject({
      name: null, workoutCount: 0, completedSets: 0,
      strengthReps: 0, strengthVolumeKg: 0, bestWeightKg: null,
      daily: [],
    });

    const other = await request(app.getHttpServer())
      .get('/workout-analytics/summary')
      .set('Cookie', otherCookie)
      .query({ range: '7d' })
      .expect(200);
    expect(other.body).toMatchObject({
      workoutCount: 1, completedSets: 1, strengthVolumeKg: 1000,
    });
  });

  it('rejects arbitrary user filters, unknown ranges and invalid exercise IDs', async () => {
    for (const query of [
      { range: '365d' },
      { athleteId: anotherAthleteId },
    ]) {
      await request(app.getHttpServer())
        .get('/workout-analytics/summary')
        .set('Cookie', athleteCookie)
        .query(query)
        .expect(400);
    }
    await request(app.getHttpServer())
      .get('/workout-analytics/exercises/not-a-uuid')
      .set('Cookie', athleteCookie)
      .expect(400);
  });

  it('uses the completed-at athlete/status index for bounded queries', async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
        EXPLAIN
        SELECT "id"
        FROM "workouts"
        WHERE "athlete_id" = ${athleteId}
          AND "status" = 'COMPLETED'
          AND "completed_at" >= ${utcDate(7, 0)}
        ORDER BY "completed_at" DESC
      `;
    });
    expect(rows.some((row) => row['QUERY PLAN'].includes(
      'workouts_athlete_id_status_completed_at_idx',
    ))).toBe(true);
  });
});
