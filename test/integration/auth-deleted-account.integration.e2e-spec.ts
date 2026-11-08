import { randomUUID } from 'node:crypto';

import { PasswordHasher } from '@nestjs/authentication';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/index.js';
import { PrismaSessionStore, PrismaTokenStore } from '../../src/modules/auth/stores/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

describe('Soft-deleted identity cannot authenticate (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: PrismaSessionStore;
  let tokens: PrismaTokenStore;
  let userId = '';

  const email = 'soft-deleted-' + randomUUID() + '@example.test';
  const password = 'StrongPassword123!';

  beforeAll(async () => {
    useTestDatabase();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    sessions = app.get(PrismaSessionStore);
    tokens = app.get(PrismaTokenStore);
    const hasher = app.get(PasswordHasher);
    const user = await prisma.user.create({
      data: { email, passwordHash: await hasher.hash(password) },
      select: { id: true },
    });
    userId = user.id;
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma && userId) {
        await prisma.user.deleteMany({ where: { id: userId } });
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('denies sessions, bearer and refresh tokens, password login, and identity reuse', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    const rawSetCookie = login.headers['set-cookie'];
    const setCookies: string[] = Array.isArray(rawSetCookie)
      ? rawSetCookie
      : rawSetCookie
        ? [rawSetCookie]
        : [];
    const cookie = setCookies
      .map((item) => item.split(';', 1)[0] ?? '')
      .find((item) => item.startsWith('__Host-sid='));
    expect(cookie).toBeDefined();

    const issued = await request(app.getHttpServer())
      .post('/auth/token')
      .send({ email, password })
      .expect(200);
    const { accessToken, refreshToken } = issued.body as {
      accessToken: string;
      refreshToken: string;
    };

    const session = await prisma.session.findFirstOrThrow({
      where: { userId },
      select: { id: true, lastActiveAt: true },
    });
    const refresh = await prisma.refreshToken.findFirstOrThrow({
      where: { userId },
      select: { id: true },
    });

    expect(await sessions.getSession(session.id)).toBeDefined();
    expect(await tokens.getRefreshToken(refresh.id)).toBeDefined();

    await request(app.getHttpServer())
      .get('/')
      .set('Authorization', 'Bearer ' + accessToken)
      .expect(200);

    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });

    expect(await sessions.getSession(session.id)).toBeUndefined();
    expect(await tokens.getRefreshToken(refresh.id)).toBeUndefined();
    expect(await sessions.listUserSessions(userId)).toEqual([]);

    await sessions.touchSession(
      session.id,
      new Date(session.lastActiveAt.getTime() + 60000),
    );
    const stored = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
      select: { lastActiveAt: true },
    });
    expect(stored.lastActiveAt).toEqual(session.lastActiveAt);

    await request(app.getHttpServer())
      .get('/')
      .set('Cookie', cookie!)
      .expect(401);
    await request(app.getHttpServer())
      .get('/')
      .set('Authorization', 'Bearer ' + accessToken)
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(409);

    expect(await prisma.user.count({ where: { email } })).toBe(1);
  }, 30_000);
});
