import { randomUUID } from 'node:crypto';

import { PasswordHasher } from '@nestjs/authentication';
import {
  StandardSchemaValidationPipe,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/infra/database/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

/**
 * Cross-module, cross-credential IDOR/BOLA regression suite.
 * Uses real sessions, JWTs and PostgreSQL rather than controller mocks.
 */
describe('API principal isolation (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerId = '';
  let attackerId = '';
  let ownerCookie = '';
  let attackerCookie = '';
  let ownerAccessToken = '';
  let attackerAccessToken = '';
  let ownerRefreshToken = '';
  let attackerRefreshToken = '';
  let measurementId = '';
  let workoutId = '';
  let exerciseId = '';

  const suffix = randomUUID();
  const ownerEmail = `isolation-owner-${suffix}@example.test`;
  const attackerEmail = `isolation-other-${suffix}@example.test`;
  const password = 'StrongPassword123!';
  const secretWorkout = `OWNER_PRIVATE_WORKOUT_${suffix}`;
  const secretExercise = `OWNER_PRIVATE_EXERCISE_${suffix}`;
  const secretNotes = `OWNER_PRIVATE_MEASUREMENT_${suffix}`;

  function cookieFrom(headers: string | string[] | undefined): string {
    const cookies = Array.isArray(headers) ? headers : headers ? [headers] : [];
    const cookie = cookies
      .map((item) => item.split(';', 1)[0] ?? '')
      .find((item) => item.startsWith('__Host-sid='));
    if (!cookie) throw new Error('Expected a real session cookie');
    return cookie;
  }

  async function authenticate(email: string) {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    expect(login.status).toBe(200);
    const issue = await request(app.getHttpServer())
      .post('/auth/token')
      .send({ email, password });
    expect(issue.status).toBe(200);
    expect(issue.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    return {
      cookie: cookieFrom(login.headers['set-cookie']),
      accessToken: issue.body.accessToken as string,
      refreshToken: issue.body.refreshToken as string,
    };
  }

  beforeAll(async () => {
    useTestDatabase();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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

    const hash = await app.get(PasswordHasher).hash(password);
    const owner = await prisma.user.create({
      data: { email: ownerEmail, passwordHash: hash, role: 'ATHLETE' },
      select: { id: true },
    });
    ownerId = owner.id;
    const attacker = await prisma.user.create({
      data: { email: attackerEmail, passwordHash: hash, role: 'ATHLETE' },
      select: { id: true },
    });
    attackerId = attacker.id;

    const first = await authenticate(ownerEmail);
    ownerCookie = first.cookie;
    ownerAccessToken = first.accessToken;
    ownerRefreshToken = first.refreshToken;
    const second = await authenticate(attackerEmail);
    attackerCookie = second.cookie;
    attackerAccessToken = second.accessToken;
    attackerRefreshToken = second.refreshToken;

    const measurement = await prisma.bodyMeasurement.create({
      data: { userId: ownerId, weightKg: 82.25, notes: secretNotes },
      select: { id: true },
    });
    measurementId = measurement.id;

    const workout = await prisma.workout.create({
      data: {
        title: secretWorkout,
        athlete: { connect: { id: ownerId } },
        createdBy: { connect: { id: ownerId } },
      },
      select: { id: true },
    });
    workoutId = workout.id;

    await prisma.muscleGroup.upsert({
      where: { slug: 'chest' },
      update: {},
      create: { slug: 'chest', name: 'Chest' },
    });
    const exercise = await prisma.exercise.create({
      data: {
        name: secretExercise,
        source: 'ATHLETE_CUSTOM',
        visibility: 'PRIVATE',
        exerciseType: 'STRENGTH',
        createdBy: { connect: { id: ownerId } },
        muscleGroups: {
          create: [{
            role: 'PRIMARY',
            muscleGroup: { connect: { slug: 'chest' } },
          }],
        },
      },
      select: { id: true },
    });
    exerciseId = exercise.id;
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma) {
        if (workoutId) await prisma.workout.deleteMany({ where: { id: workoutId } });
        if (exerciseId) await prisma.exercise.deleteMany({ where: { id: exerciseId } });
        if (measurementId) {
          await prisma.bodyMeasurement.deleteMany({ where: { id: measurementId } });
        }
        const ids = [ownerId, attackerId].filter(Boolean);
        if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('ignores forged identity and role headers for session and bearer credentials', async () => {
    const clients = [
      { header: 'Cookie', credential: ownerCookie },
      { header: 'Authorization', credential: `Bearer ${ownerAccessToken}` },
    ];
    for (const client of clients) {
      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set(client.header, client.credential)
        .set('X-User-Id', attackerId)
        .set('X-Role', 'ADMIN')
        .set('X-Forwarded-User', attackerId)
        .query({ userId: attackerId });
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({
        id: ownerId,
        email: ownerEmail,
        role: 'ATHLETE',
      });
      expect(JSON.stringify(response.body)).not.toContain(attackerEmail);
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(response.body).not.toHaveProperty('deletedAt');
      expect(response.body.profile).not.toHaveProperty('avatarKey');
    }
  });

  it('uses the registered session-first provider when both valid credential types are supplied', async () => {
    const response = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', ownerCookie)
      .set('Authorization', `Bearer ${attackerAccessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(ownerId);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('does not expose or modify foreign measurements over cookie or JWT, even with impersonation headers', async () => {
    for (const client of [
      { header: 'Cookie', value: attackerCookie },
      { header: 'Authorization', value: `Bearer ${attackerAccessToken}` },
    ]) {
      const calls = [
        () => request(app.getHttpServer())
          .get(`/body-measurements/${measurementId}`)
          .set(client.header, client.value),
        () => request(app.getHttpServer())
          .patch(`/body-measurements/${measurementId}`)
          .set(client.header, client.value)
          .set('X-User-Id', ownerId)
          .send({ weightKg: 65.5 }),
        () => request(app.getHttpServer())
          .delete(`/body-measurements/${measurementId}`)
          .set(client.header, client.value),
      ];
      for (const call of calls) {
        const response = await call();
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({
          statusCode: 404,
          code: 'NOT_FOUND',
          requestId: response.headers['x-request-id'],
        });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(JSON.stringify(response.body)).not.toContain(secretNotes);
      }
    }
    const stored = await prisma.bodyMeasurement.findUniqueOrThrow({
      where: { id: measurementId },
    });
    expect(stored.userId).toBe(ownerId);
    expect(stored.weightKg.toString()).toBe('82.25');
  });

  it('cannot select or write a different account through userId or role mass-assignment', async () => {
    const foreignList = await request(app.getHttpServer())
      .get('/body-measurements')
      .set('Authorization', `Bearer ${attackerAccessToken}`);
    expect(foreignList.status).toBe(200);
    expect(foreignList.body.data).toEqual([]);

    const forbiddenQuery = await request(app.getHttpServer())
      .get('/body-measurements')
      .set('Authorization', `Bearer ${attackerAccessToken}`)
      .query({ userId: ownerId });
    expect(forbiddenQuery.status).toBe(400);
    expect(forbiddenQuery.headers['cache-control']).toBe('no-store');

    const foreignCreate = await request(app.getHttpServer())
      .post('/body-measurements')
      .set('Cookie', attackerCookie)
      .send({ userId: ownerId, weightKg: 75 });
    expect(foreignCreate.status).toBe(400);

    const roleEscalation = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${attackerAccessToken}`)
      .send({ id: ownerId, role: 'ADMIN', name: 'Hijacked' });
    expect(roleEscalation.status).toBe(400);

    const attacker = await prisma.user.findUniqueOrThrow({
      where: { id: attackerId },
      select: { role: true },
    });
    expect(attacker.role).toBe('ATHLETE');
    expect(await prisma.bodyMeasurement.count({ where: { userId: attackerId } })).toBe(0);
  });

  it('prevents cross-account workout reads, edits and state transitions', async () => {
    const attempts = [
      () => request(app.getHttpServer())
        .get(`/workouts/${workoutId}`)
        .set('Authorization', `Bearer ${attackerAccessToken}`),
      () => request(app.getHttpServer())
        .patch(`/workouts/${workoutId}`)
        .set('Cookie', attackerCookie)
        .send({ title: 'Changed by attacker' }),
      () => request(app.getHttpServer())
        .post(`/workouts/${workoutId}/start`)
        .set('Authorization', `Bearer ${attackerAccessToken}`),
      () => request(app.getHttpServer())
        .post(`/workouts/${workoutId}/complete`)
        .set('Cookie', attackerCookie),
    ];
    for (const attempt of attempts) {
      const response = await attempt();
      expect(response.status).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(response.body)).not.toContain(secretWorkout);
    }
    const owner = await request(app.getHttpServer())
      .get(`/workouts/${workoutId}`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(owner.status).toBe(200);
    expect(owner.body.title).toBe(secretWorkout);
    const persisted = await prisma.workout.findUniqueOrThrow({
      where: { id: workoutId },
      select: { title: true, status: true, athleteId: true },
    });
    expect(persisted).toEqual({ title: secretWorkout, status: 'PLANNED', athleteId: ownerId });
  });

  it('hides private exercises from guests and the other account without exposing exercise names', async () => {
    for (const credential of [null, `Bearer ${attackerAccessToken}`]) {
      const list = request(app.getHttpServer())
        .get('/exercises')
        .query({ search: secretExercise });
      if (credential) list.set('Authorization', credential);
      const listed = await list;
      expect(listed.status).toBe(200);
      expect(listed.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(listed.body)).not.toContain(secretExercise);

      const get = request(app.getHttpServer()).get(`/exercises/${exerciseId}`);
      if (credential) get.set('Authorization', credential);
      const result = await get;
      expect(result.status).toBe(404);
      expect(JSON.stringify(result.body)).not.toContain(secretExercise);
    }
    for (const operation of ['patch', 'delete'] as const) {
      const req = operation === 'patch'
        ? request(app.getHttpServer()).patch(`/exercises/${exerciseId}`).send({ name: 'Hijacked' })
        : request(app.getHttpServer()).delete(`/exercises/${exerciseId}`);
      const response = await req.set('Authorization', `Bearer ${attackerAccessToken}`);
      expect(response.status).toBe(403);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(response.body)).not.toContain(secretExercise);
    }
    const own = await request(app.getHttpServer())
      .get(`/exercises/${exerciseId}`)
      .set('Cookie', ownerCookie);
    expect(own.status).toBe(200);
    expect(own.body.name).toBe(secretExercise);
    const exercise = await prisma.exercise.findUniqueOrThrow({
      where: { id: exerciseId },
      select: { isArchived: true, name: true },
    });
    expect(exercise).toEqual({ isArchived: false, name: secretExercise });
  });

  it('sign-out-everywhere revokes only the acting user’s refresh-token family', async () => {
    const revoke = await request(app.getHttpServer())
      .post('/auth/sign-out-everywhere')
      .set('Authorization', `Bearer ${attackerAccessToken}`);
    expect(revoke.status).toBe(204);
    expect(revoke.headers['cache-control']).toBe('no-store');

    const attackerRefresh = await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken: attackerRefreshToken });
    expect(attackerRefresh.status).toBe(401);
    expect(attackerRefresh.headers['cache-control']).toBe('no-store');

    const ownerRefresh = await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken: ownerRefreshToken });
    expect(ownerRefresh.status).toBe(200);
    expect(ownerRefresh.headers['cache-control']).toBe('no-store');
    expect(ownerRefresh.body.accessToken).toEqual(expect.any(String));
    expect(ownerRefresh.body.refreshToken).toEqual(expect.any(String));
    expect(ownerRefresh.body.refreshToken).not.toBe(ownerRefreshToken);
  });
});
