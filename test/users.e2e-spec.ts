import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { StandardSchemaValidationPipe, ValidationPipe } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/index.js';
import { useTestDatabase } from './utility/test-db-helper.js';

describe('Users /me (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let athleteId: string;
  let otherId: string;
  let athleteCookie: string;
  let otherCookie: string;

  const password = 'StrongPassword123!';
  const suffix = randomUUID();
  const athleteEmail = `user-profile-athlete-${suffix}@example.com`;
  const otherEmail = `user-profile-other-${suffix}@example.com`;

  function sessionCookie(header: string | string[] | undefined): string {
    const cookies = Array.isArray(header) ? header : header ? [header] : [];
    const cookie = cookies
      .map((value) => value.split(';', 1)[0] ?? '')
      .find((value) => value.startsWith('__Host-sid='));
    if (!cookie) throw new Error('Expected a session cookie');
    return cookie;
  }

  async function login(email: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    expect(response.status).toBe(200);
    return sessionCookie(response.headers['set-cookie']);
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
    const hasher = app.get(PasswordHasher);
    const hash = await hasher.hash(password);

    const athlete = await prisma.user.create({
      data: {
        email: athleteEmail,
        passwordHash: hash,
        role: 'ATHLETE',
      },
      select: { id: true },
    });
    athleteId = athlete.id;
    const other = await prisma.user.create({
      data: {
        email: otherEmail,
        passwordHash: hash,
        role: 'TRAINER',
      },
      select: { id: true },
    });
    otherId = other.id;

    athleteCookie = await login(athleteEmail);
    otherCookie = await login(otherEmail);
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma) {
        const userIds = [athleteId, otherId].filter(Boolean);
        if (userIds.length) {
          await prisma.profile.deleteMany({
            where: { userId: { in: userIds } },
          });
          await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        }
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('requires authentication for both routes', async () => {
    const get = await request(app.getHttpServer()).get('/users/me');
    const patch = await request(app.getHttpServer())
      .patch('/users/me')
      .send({ name: 'Anonymous' });
    expect(get.status).toBe(401);
    expect(patch.status).toBe(401);
  });

  it('returns current account with null profile and no secrets', async () => {
    const response = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', athleteCookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: athleteId,
      email: athleteEmail,
      role: 'ATHLETE',
      emailVerified: false,
      profile: null,
    });
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(response.body).not.toHaveProperty('deletedAt');
  });

  it('creates profile on first PATCH and returns date-only birthday', async () => {
    const response = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Cookie', athleteCookie)
      .send({
        name: '  Athlete One  ',
        birthday: '1998-03-04',
        height: 193,
        weight: 81.25,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: athleteId,
      profile: {
        name: 'Athlete One',
        birthday: '1998-03-04',
        height: 193,
        weight: 81.25,
      },
    });
    expect(response.body.profile).not.toHaveProperty('userId');

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: athleteId },
    });
    expect(stored.birthday?.toISOString().slice(0, 10)).toBe('1998-03-04');
    expect(stored.weight?.toFixed(2)).toBe('81.25');
  });

  it('updates only specified fields and leaves other fields unchanged', async () => {
    const response = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Cookie', athleteCookie)
      .send({ weight: 82.75 });

    expect(response.status).toBe(200);
    expect(response.body.profile).toMatchObject({
      name: 'Athlete One',
      birthday: '1998-03-04',
      height: 193,
      weight: 82.75,
    });
  });

  it('allows clearing nullable fields', async () => {
    const response = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Cookie', athleteCookie)
      .send({ name: null, birthday: null });

    expect(response.status).toBe(200);
    expect(response.body.profile).toMatchObject({
      name: null, birthday: null, height: 193, weight: 82.75,
    });
  });

  it('rejects account/role edits, empty bodies and invalid values', async () => {
    for (const body of [
      {},
      { role: 'ADMIN' },
      { email: 'new@example.com' },
      { passwordHash: 'malicious' },
      { birthday: '2100-01-01' },
      { height: 1000 },
      { weight: 80.555 },
      { name: '   ' },
    ]) {
      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Cookie', athleteCookie)
        .send(body);
      expect(response.status).toBe(400);
    }
    const account = await prisma.user.findUniqueOrThrow({
      where: { id: athleteId },
      select: { role: true, email: true },
    });
    expect(account).toEqual({ role: 'ATHLETE', email: athleteEmail });
  });

  it('isolates profiles between authenticated users', async () => {
    const otherUpdate = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Cookie', otherCookie)
      .send({ name: 'Trainer', height: 185 });
    expect(otherUpdate.status).toBe(200);
    expect(otherUpdate.body).toMatchObject({
      id: otherId,
      role: 'TRAINER',
      profile: { name: 'Trainer', height: 185 },
    });

    const athlete = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', athleteCookie);
    expect(athlete.body.id).toBe(athleteId);
    expect(athlete.body.profile).toMatchObject({ name: null, height: 193, weight: 82.75 });
    expect(athlete.body.profile).not.toMatchObject({ name: 'Trainer' });
  });

  it('rejects a soft-deleted account even with an existing session', async () => {
    await prisma.user.update({
      where: { id: otherId },
      data: { deletedAt: new Date() },
    });

    const result = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', otherCookie);
    expect(result.status).toBe(401);
  });
});
