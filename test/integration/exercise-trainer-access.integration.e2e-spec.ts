import { randomUUID } from 'node:crypto';

import { PasswordHasher } from '@nestjs/authentication';
import {
  StandardSchemaValidationPipe,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/infra/database/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

describe('Exercise trainer access (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerId = '';
  let trainerId = '';
  let otherTrainerId = '';
  let outsiderId = '';
  let relationshipId = '';
  let sharedId = '';
  let privateId = '';
  let foreignId = '';
  let globalId = '';
  let ownerCookie = '';
  let trainerCookie = '';
  let outsiderCookie = '';

  const suffix = randomUUID();
  const password = 'StrongPassword123!';
  const base = `trainer-grants-${suffix}`;
  const ids: string[] = [];

  function cookieFrom(headers: string | string[] | undefined): string {
    const entries = Array.isArray(headers) ? headers : headers ? [headers] : [];
    const cookie = entries
      .map((value) => value.split(';', 1)[0] ?? '')
      .find((value) => value.startsWith('__Host-sid='));
    if (!cookie) throw new Error('Missing session cookie');
    return cookie;
  }

  async function login(email: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    expect(response.status).toBe(200);
    return cookieFrom(response.headers['set-cookie']);
  }

  beforeAll(async () => {
    useTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
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

    const passwordHash = await app.get(PasswordHasher).hash(password);
    async function createUser(
      key: string,
      role: 'ATHLETE' | 'TRAINER',
    ) {
      const email = `${base}-${key}@example.test`;
      const user = await prisma.user.create({
        data: { email, passwordHash, role },
        select: { id: true },
      });
      ids.push(user.id);
      return { id: user.id, email };
    }

    const owner = await createUser('owner', 'ATHLETE');
    const trainer = await createUser('trainer', 'TRAINER');
    const otherTrainer = await createUser('other-trainer', 'TRAINER');
    const outsider = await createUser('outsider', 'ATHLETE');
    ownerId = owner.id;
    trainerId = trainer.id;
    otherTrainerId = otherTrainer.id;
    outsiderId = outsider.id;

    const relationship = await prisma.trainerAthlete.create({
      data: {
        trainerId,
        athleteId: ownerId,
        initiatedById: ownerId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    relationshipId = relationship.id;

    async function makeExercise(
      source: 'GLOBAL' | 'ATHLETE_CUSTOM',
      createdById: string | null,
      visibility: 'PRIVATE' | 'SELECTED_TRAINERS' | null,
    ) {
      return prisma.exercise.create({
        data: {
          name: `${base}-exercise`,
          source,
          createdById,
          visibility,
          exerciseType: 'STRENGTH',
        },
        select: { id: true },
      });
    }

    sharedId = (await makeExercise('ATHLETE_CUSTOM', ownerId, 'SELECTED_TRAINERS')).id;
    privateId = (await makeExercise('ATHLETE_CUSTOM', ownerId, 'PRIVATE')).id;
    foreignId = (await makeExercise('ATHLETE_CUSTOM', outsiderId, 'SELECTED_TRAINERS')).id;
    globalId = (await makeExercise('GLOBAL', null, null)).id;

    ownerCookie = await login(owner.email);
    trainerCookie = await login(trainer.email);
    outsiderCookie = await login(outsider.email);
  }, 30_000);

  beforeEach(async () => {
    await prisma.exercise.update({
      where: { id: sharedId },
      data: { visibility: 'SELECTED_TRAINERS', isArchived: false },
    });
    await prisma.trainerAthlete.update({
      where: { id: relationshipId },
      data: { status: 'ACTIVE', endedAt: null, endedById: null },
    });
    await prisma.exerciseTrainerAccess.updateMany({
      where: { exerciseId: sharedId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const exerciseIds = [sharedId, privateId, foreignId, globalId].filter(Boolean);
        if (exerciseIds.length) {
          await prisma.exercise.deleteMany({ where: { id: { in: exerciseIds } } });
        }
        if (relationshipId) {
          await prisma.trainerAthlete.delete({ where: { id: relationshipId } });
        }
        if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('requires authentication and athlete ownership', async () => {
    const path = `/exercises/${sharedId}/trainer-access`;
    expect((await request(app.getHttpServer()).post(path)
      .send({ trainerId })).status).toBe(401);
    expect((await request(app.getHttpServer()).post(path)
      .set('Cookie', trainerCookie).send({ trainerId })).status).toBe(403);
    expect((await request(app.getHttpServer()).get(path)
      .set('Cookie', trainerCookie)).status).toBe(403);
    expect((await request(app.getHttpServer()).post(path)
      .set('Cookie', outsiderCookie).send({ trainerId })).status).toBe(404);
    expect((await request(app.getHttpServer()).delete(`${path}/${trainerId}`)
      .set('Cookie', outsiderCookie)).status).toBe(404);
    expect((await request(app.getHttpServer()).post(
      `/exercises/${foreignId}/trainer-access`,
    ).set('Cookie', ownerCookie).send({ trainerId })).status).toBe(404);
    expect((await request(app.getHttpServer()).post(
      `/exercises/${globalId}/trainer-access`,
    ).set('Cookie', ownerCookie).send({ trainerId })).status).toBe(404);
  });

  it('rejects private exercises, inactive relationships and malformed IDs', async () => {
    const appServer = app.getHttpServer();
    expect((await request(appServer).post(`/exercises/${privateId}/trainer-access`)
      .set('Cookie', ownerCookie).send({ trainerId })).status).toBe(409);
    expect((await request(appServer).post(`/exercises/${sharedId}/trainer-access`)
      .set('Cookie', ownerCookie).send({ trainerId: otherTrainerId })).status)
      .toBe(409);
    expect((await request(appServer).post(`/exercises/${sharedId}/trainer-access`)
      .set('Cookie', ownerCookie).send({ trainerId: 'not-a-uuid' })).status)
      .toBe(400);
    expect((await request(appServer).post(`/exercises/${sharedId}/trainer-access`)
      .set('Cookie', ownerCookie).send({ trainerId, role: 'ADMIN' })).status)
      .toBe(400);
    expect((await request(appServer).delete(`/exercises/${sharedId}/trainer-access/nope`)
      .set('Cookie', ownerCookie)).status).toBe(400);
  });

  it('grants, lists and revokes; hides data from non-granted trainers', async () => {
    const path = `/exercises/${sharedId}/trainer-access`;
    const server = app.getHttpServer();
    const granted = await request(server).post(path)
      .set('Cookie', ownerCookie).send({ trainerId });
    expect(granted.status).toBe(200);
    expect(granted.body).toMatchObject({
      exerciseId: sharedId,
      trainerId,
      revokedAt: null,
    });
    expect(granted.body).not.toHaveProperty('email');
    expect((await request(server).get(`/exercises/${sharedId}`)
      .set('Cookie', trainerCookie)).status).toBe(200);

    const list = await request(server).get(path).set('Cookie', ownerCookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].trainerId).toBe(trainerId);

    expect((await request(server).post(path).set('Cookie', ownerCookie)
      .send({ trainerId })).status).toBe(200);
    expect(await prisma.exerciseTrainerAccess.count({
      where: { exerciseId: sharedId, trainerId, revokedAt: null },
    })).toBe(1);

    const revoke = await request(server).delete(`${path}/${trainerId}`)
      .set('Cookie', ownerCookie);
    expect(revoke.status).toBe(204);
    expect((await request(server).delete(`${path}/${trainerId}`)
      .set('Cookie', ownerCookie)).status).toBe(204);
    expect((await request(server).get(`/exercises/${sharedId}`)
      .set('Cookie', trainerCookie)).status).toBe(404);
    expect((await request(server).get(path).set('Cookie', ownerCookie)).body)
      .toEqual([]);

    expect((await request(server).post(path).set('Cookie', ownerCookie)
      .send({ trainerId })).status).toBe(200);
    expect((await request(server).get(`/exercises/${sharedId}`)
      .set('Cookie', trainerCookie)).status).toBe(200);
  });

  it('revokes all grants when visibility becomes PRIVATE', async () => {
    const server = app.getHttpServer();
    const path = `/exercises/${sharedId}/trainer-access`;
    expect((await request(server).post(path).set('Cookie', ownerCookie)
      .send({ trainerId })).status).toBe(200);

    const hidden = await request(server).patch(`/exercises/${sharedId}`)
      .set('Cookie', ownerCookie).send({ visibility: 'PRIVATE' });
    expect(hidden.status).toBe(200);
    expect((await request(server).get(`/exercises/${sharedId}`)
      .set('Cookie', trainerCookie)).status).toBe(404);
    expect(await prisma.exerciseTrainerAccess.count({
      where: { exerciseId: sharedId, trainerId, revokedAt: null },
    })).toBe(0);

    expect((await request(server).post(path).set('Cookie', ownerCookie)
      .send({ trainerId })).status).toBe(409);
  });

  it('terminating a relationship revokes grants and prevents re-grant', async () => {
    const server = app.getHttpServer();
    const path = `/exercises/${sharedId}/trainer-access`;
    expect((await request(server).post(path).set('Cookie', ownerCookie)
      .send({ trainerId })).status).toBe(200);

    const termination = await request(server)
      .post(`/trainer-athletes/${relationshipId}/terminate`)
      .set('Cookie', ownerCookie)
      .send({});
    expect(termination.status).toBe(200);

    expect(await prisma.exerciseTrainerAccess.count({
      where: { exerciseId: sharedId, trainerId, revokedAt: null },
    })).toBe(0);
    expect((await request(server).get(`/exercises/${sharedId}`)
      .set('Cookie', trainerCookie)).status).toBe(404);
    expect((await request(server).post(path).set('Cookie', ownerCookie)
      .send({ trainerId })).status).toBe(409);
    expect((await request(server).get(path).set('Cookie', ownerCookie)).body)
      .toEqual([]);
  });
});
