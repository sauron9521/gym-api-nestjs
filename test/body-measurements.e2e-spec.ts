import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { StandardSchemaValidationPipe, ValidationPipe } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/index.js';
import { useTestDatabase } from './utility/test-db-helper.js';

describe('Body Measurements (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let firstId: string;
  let secondId: string;
  let firstCookie: string;
  let secondCookie: string;
  let measurementId: string;
  const password = 'StrongPassword123!';
  const suffix = randomUUID();
  const firstEmail = `body-measure-first-${suffix}@example.com`;
  const secondEmail = `body-measure-second-${suffix}@example.com`;

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    expect(res.status).toBe(200);
    const setCookies: string[] = res.headers['set-cookie'] ?? [];
    const cookie = setCookies
      .map((value) => value.split(';')[0] ?? '')
      .find((value) => value.startsWith('__Host-sid='));
    if (!cookie) throw new Error('Missing auth session cookie');
    return cookie;
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
    const hash = await app.get(PasswordHasher).hash(password);
    const first = await prisma.user.create({
      data: { email: firstEmail, passwordHash: hash, role: 'ATHLETE' },
      select: { id: true },
    });
    firstId = first.id;
    const second = await prisma.user.create({
      data: { email: secondEmail, passwordHash: hash, role: 'TRAINER' },
      select: { id: true },
    });
    secondId = second.id;
    firstCookie = await login(firstEmail);
    secondCookie = await login(secondEmail);
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma) {
        const ids = [firstId, secondId].filter(Boolean);
        if (ids.length) {
          await prisma.bodyMeasurement.deleteMany({
            where: { userId: { in: ids } },
          });
          await prisma.user.deleteMany({
            where: { id: { in: ids } },
          });
        }
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('rejects requests without authentication', async () => {
    expect((await request(app.getHttpServer())
      .get('/body-measurements')).status).toBe(401);
    expect((await request(app.getHttpServer())
      .post('/body-measurements').send({ weightKg: 80 })).status).toBe(401);
  });

  it('creates a precise record without changing Profile.weight', async () => {
    const body = {
      weightKg: 81.25, bodyFatPct: 14.5, waistCm: 82.25,
      measuredAt: '2026-11-08T10:30:00+02:00',
      notes: '  Morning  ',
    };
    const res = await request(app.getHttpServer())
      .post('/body-measurements')
      .set('Cookie', firstCookie)
      .send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      weightKg: 81.25, bodyFatPct: 14.5, waistCm: 82.25,
      measuredAt: '2026-11-08T08:30:00.000Z',
      notes: 'Morning',
    });
    expect(res.body).not.toHaveProperty('userId');
    measurementId = res.body.id;
    const stored = await prisma.bodyMeasurement.findUniqueOrThrow({
      where: { id: measurementId },
    });
    expect(stored.weightKg?.toFixed(2)).toBe('81.25');
    const profile = await prisma.profile.findUnique({
      where: { userId: firstId },
    });
    expect(profile).toBeNull();
  });

  it('returns a sorted, filtered paginated history', async () => {
    const res = await request(app.getHttpServer())
      .get('/body-measurements')
      .set('Cookie', firstCookie)
      .query({ page: 1, limit: 10 });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(measurementId);
    expect(res.body.meta).toMatchObject({
      total: 1, skip: 0, take: 10, totalPages: 1,
    });

    const filtered = await request(app.getHttpServer())
      .get('/body-measurements')
      .set('Cookie', firstCookie)
      .query({
        from: '2026-11-09T00:00:00Z',
        to: '2026-11-10T00:00:00Z',
      });
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toEqual([]);
  });

  it('keeps all measurements private to the authenticated user', async () => {
    const list = await request(app.getHttpServer())
      .get('/body-measurements')
      .set('Cookie', secondCookie);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);

    const get = await request(app.getHttpServer())
      .get(`/body-measurements/${measurementId}`)
      .set('Cookie', secondCookie);
    const patch = await request(app.getHttpServer())
      .patch(`/body-measurements/${measurementId}`)
      .set('Cookie', secondCookie)
      .send({ weightKg: 72 });
    const remove = await request(app.getHttpServer())
      .delete(`/body-measurements/${measurementId}`)
      .set('Cookie', secondCookie);

    expect(get.status).toBe(404);
    expect(patch.status).toBe(404);
    expect(remove.status).toBe(404);
  });

  it('supports partial update and prevents clearing the final metric', async () => {
    const update = await request(app.getHttpServer())
      .patch(`/body-measurements/${measurementId}`)
      .set('Cookie', firstCookie)
      .send({ weightKg: 81.75, waistCm: null });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({
      weightKg: 81.75, waistCm: null, bodyFatPct: 14.5,
    });

    const single = await request(app.getHttpServer())
      .post('/body-measurements')
      .set('Cookie', firstCookie)
      .send({ chestCm: 105 });
    expect(single.status).toBe(201);

    const invalid = await request(app.getHttpServer())
      .patch(`/body-measurements/${single.body.id}`)
      .set('Cookie', firstCookie)
      .send({ chestCm: null });
    expect(invalid.status).toBe(400);
  });

  it('rejects invalid, empty and future-dated records', async () => {
    for (const body of [
      {}, { notes: 'Only notes' }, { weightKg: 80.555 },
      { weightKg: 0 }, { weightKg: 601 },
      { weightKg: 80, userId: secondId },
      { weightKg: 80, measuredAt: '2099-01-01T00:00:00Z' },
    ]) {
      const res = await request(app.getHttpServer())
        .post('/body-measurements')
        .set('Cookie', firstCookie)
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it('deletes own records with 204 and returns 404 afterward', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/body-measurements/${measurementId}`)
      .set('Cookie', firstCookie);
    expect(res.status).toBe(204);
    const after = await request(app.getHttpServer())
      .get(`/body-measurements/${measurementId}`)
      .set('Cookie', firstCookie);
    expect(after.status).toBe(404);
  });
});
