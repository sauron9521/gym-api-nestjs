import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { StandardSchemaValidationPipe, ValidationPipe } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import sharp from 'sharp';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/database/index.js';
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

  it('updates all new profile fields without changing existing metrics', async () => {
    const url = 'https://cdn.example.com/avatars/athlete-1.webp';
    const response = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Cookie', athleteCookie)
      .send({
        firstName: '  Anna ',
        lastName: ' Smith ',
        displayName: ' Anna S. ',
        avatarUrl: url,
        timezone: 'Europe/Kyiv',
      });

    expect(response.status).toBe(200);
    expect(response.body.profile).toMatchObject({
      name: 'Anna S.',
      firstName: 'Anna',
      lastName: 'Smith',
      displayName: 'Anna S.',
      avatarUrl: url,
      timezone: 'Europe/Kyiv',
      height: 193,
      weight: 82.75,
    });

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: athleteId },
    });
    expect(stored.name).toBe('Anna S.');
    expect(stored.displayName).toBe('Anna S.');
    expect(stored.firstName).toBe('Anna');
    expect(stored.lastName).toBe('Smith');
  });

  it('preserves the legacy name PATCH contract and syncs displayName', async () => {
    const legacy = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Cookie', athleteCookie)
      .send({ name: 'Legacy Nick' });

    expect(legacy.status).toBe(200);
    expect(legacy.body.profile).toMatchObject({
      name: 'Legacy Nick',
      displayName: 'Legacy Nick',
      firstName: 'Anna',
      lastName: 'Smith',
      timezone: 'Europe/Kyiv',
    });

    const cleared = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Cookie', athleteCookie)
      .send({ displayName: null, avatarUrl: null });

    expect(cleared.status).toBe(200);
    expect(cleared.body.profile).toMatchObject({
      name: null,
      displayName: null,
      avatarUrl: null,
      firstName: 'Anna',
      lastName: 'Smith',
      timezone: 'Europe/Kyiv',
    });
  });

  it('rejects invalid avatar links, time zones and mismatched names', async () => {
    for (const body of [
      { avatarUrl: 'http://insecure.example.com/photo.png' },
      { avatarUrl: 'javascript:alert(1)' },
      { avatarUrl: 'https://name:secret@example.com/photo.png' },
      { timezone: 'Europe/InvalidCity' },
      { timezone: null },
      { name: 'Old', displayName: 'New' },
      { firstName: '   ' },
      { lastName: '   ' },
    ]) {
      const result = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Cookie', athleteCookie)
        .send(body);
      expect(result.status).toBe(400);
    }
  });

  it('uploads, serves, replaces and deletes a managed avatar', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lGQAAAAASUVORK5CYII=',
      'base64',
    );

    const first = await request(app.getHttpServer())
      .post('/users/me/avatar')
      .set('Cookie', athleteCookie)
      .attach('file', png, { filename: 'profile.png', contentType: 'image/png' });

    expect(first.status).toBe(200);
    expect(first.body.avatarUrl).toMatch(new RegExp('^/avatars/[0-9a-f-]+[.]png$'));
    const firstUrl: string = first.body.avatarUrl;

    const stored = await prisma.profile.findUniqueOrThrow({
      where: { userId: athleteId },
      select: { avatarUrl: true, avatarKey: true },
    });
    expect(stored.avatarUrl).toBe(firstUrl);
    expect(stored.avatarKey).toBe(firstUrl.split('/').at(-1));

    const profile = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', athleteCookie);
    expect(profile.body.profile.avatarUrl).toBe(firstUrl);
    expect(profile.body.profile).not.toHaveProperty('avatarKey');

    const publicResponse = await request(app.getHttpServer()).get(firstUrl);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers['content-type']).toContain('image/png');
    expect(publicResponse.headers['x-content-type-options']).toBe('nosniff');
    expect(publicResponse.headers['cache-control']).toBe('no-store');

    const second = await request(app.getHttpServer())
      .post('/users/me/avatar')
      .set('Cookie', athleteCookie)
      .attach('file', png, { filename: 'other.png', contentType: 'image/png' });

    expect(second.status).toBe(200);
    expect(second.body.avatarUrl).not.toBe(firstUrl);
    expect((await request(app.getHttpServer()).get(firstUrl)).status).toBe(404);
    expect((await request(app.getHttpServer()).get(second.body.avatarUrl)).status).toBe(200);

    const removed = await request(app.getHttpServer())
      .delete('/users/me/avatar')
      .set('Cookie', athleteCookie);

    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ avatarUrl: null });
    expect((await request(app.getHttpServer()).get(second.body.avatarUrl)).status).toBe(404);

    const after = await prisma.profile.findUniqueOrThrow({
      where: { userId: athleteId },
      select: { avatarKey: true, avatarUrl: true },
    });
    expect(after).toEqual({ avatarKey: null, avatarUrl: null });
  });

  it('serves a resized JPEG without source EXIF metadata', async () => {
    const original = await sharp({
      create: { width: 1024, height: 640, channels: 3, background: 'blue' },
    })
      .withExif({ IFD0: { ImageDescription: 'PRIVATE-METADATA' } })
      .jpeg()
      .toBuffer();

    expect((await sharp(original).metadata()).exif).toBeDefined();

    const upload = await request(app.getHttpServer())
      .post('/users/me/avatar')
      .set('Cookie', athleteCookie)
      .attach('file', original, {
        filename: 'photo.jpg', contentType: 'image/jpeg',
      });
    expect(upload.status).toBe(200);
    expect(upload.body.avatarUrl).toMatch(new RegExp('^/avatars/[0-9a-f-]+[.]jpg$'));

    const result = await request(app.getHttpServer()).get(upload.body.avatarUrl);
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.isBuffer(result.body)).toBe(true);

    const metadata = await sharp(result.body as Buffer).metadata();
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBeLessThanOrEqual(512);
    expect(metadata.exif).toBeUndefined();
    expect((result.body as Buffer).includes(Buffer.from('PRIVATE-METADATA')))
      .toBe(false);

    await request(app.getHttpServer())
      .delete('/users/me/avatar')
      .set('Cookie', athleteCookie)
      .expect(200);
  });

  it('rejects corrupted image data after a superficially valid header', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lGQAAAAASUVORK5CYII=',
      'base64',
    );
    const truncated = png.subarray(0, 33);

    const response = await request(app.getHttpServer())
      .post('/users/me/avatar')
      .set('Cookie', athleteCookie)
      .attach('file', truncated, {
        filename: 'apparently-valid.png', contentType: 'image/png',
      });
    expect(response.status).toBe(400);

    const profile = await prisma.profile.findUniqueOrThrow({
      where: { userId: athleteId },
      select: { avatarKey: true, avatarUrl: true },
    });
    expect(profile).toEqual({ avatarKey: null, avatarUrl: null });
  });

  it('rejects malformed image bytes, large files, and unauthorized uploads', async () => {
    const fakeImage = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const unauthorized = await request(app.getHttpServer())
      .post('/users/me/avatar')
      .attach('file', fakeImage, { filename: 'image.png', contentType: 'image/png' });
    expect(unauthorized.status).toBe(401);

    const wrongMagic = await request(app.getHttpServer())
      .post('/users/me/avatar')
      .set('Cookie', athleteCookie)
      .attach('file', fakeImage, { filename: 'image.png', contentType: 'image/png' });
    expect(wrongMagic.status).toBe(400);

    const oversized = await request(app.getHttpServer())
      .post('/users/me/avatar')
      .set('Cookie', athleteCookie)
      .attach('file', Buffer.alloc(2 * 1024 * 1024 + 10), {
        filename: 'image.png',
        contentType: 'image/png',
      });
    expect([400, 413]).toContain(oversized.status);

    const missing = await request(app.getHttpServer())
      .post('/users/me/avatar')
      .set('Cookie', athleteCookie)
      .send();
    expect(missing.status).toBe(400);

    const result = await prisma.profile.findUniqueOrThrow({
      where: { userId: athleteId },
      select: { avatarUrl: true, avatarKey: true },
    });
    expect(result).toEqual({ avatarUrl: null, avatarKey: null });
  });

  it('keeps externally hosted avatar URLs compatible with PATCH', async () => {
    const response = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Cookie', athleteCookie)
      .send({ avatarUrl: 'https://cdn.example.com/avatar/legacy.png' });
    expect(response.status).toBe(200);
    expect(response.body.profile.avatarUrl).toBe(
      'https://cdn.example.com/avatar/legacy.png',
    );
    const state = await prisma.profile.findUniqueOrThrow({
      where: { userId: athleteId },
      select: { avatarUrl: true, avatarKey: true },
    });
    expect(state).toEqual({
      avatarUrl: 'https://cdn.example.com/avatar/legacy.png',
      avatarKey: null,
    });
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
