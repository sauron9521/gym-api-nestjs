import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { PrismaService } from '../../src/infra/database/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

type VisibleSession = {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  userAgent: string | null;
  current: boolean;
};

const password = 'StrongPassword123!';
const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  APP_URL: process.env.APP_URL,
  JWT_SECRET: process.env.JWT_SECRET,
};

describe('Auth session management isolation (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordHasher: PasswordHasher;
  let firstUserId = '';
  let secondUserId = '';
  let firstEmail = '';
  let secondEmail = '';

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    expect(response.body).toEqual({ mfaRequired: false });
    const raw = response.headers['set-cookie'];
    const cookies: string[] = Array.isArray(raw)
      ? raw
      : typeof raw === 'string'
        ? [raw]
        : [];
    const cookie = cookies
      .map((value) => value.split(';', 1)[0] ?? '')
      .find((value) => value.startsWith('__Host-sid='));

    if (!cookie) {
      throw new Error('Expected __Host-sid cookie after successful login');
    }

    return cookie;
  }

  async function listWithCookie(cookie: string): Promise<VisibleSession[]> {
    const response = await request(app.getHttpServer())
      .get('/auth/sessions')
      .set('Cookie', cookie)
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    return response.body as VisibleSession[];
  }

  beforeAll(async () => {
    useTestDatabase();
    process.env.APP_URL ||= 'http://localhost:3000';
    if (
      !process.env.JWT_SECRET ||
      Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32
    ) {
      process.env.JWT_SECRET = randomUUID() + randomUUID();
    }

    const { AppModule } = await import('../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    passwordHasher = app.get(PasswordHasher);
  }, 30_000);

  beforeEach(async () => {
    firstEmail = `session-owner-${randomUUID()}@example.test`;
    secondEmail = `session-other-${randomUUID()}@example.test`;
    const passwordHash = await passwordHasher.hash(password);
    const [first, second] = await prisma.$transaction([
      prisma.user.create({
        data: { email: firstEmail, passwordHash },
        select: { id: true },
      }),
      prisma.user.create({
        data: { email: secondEmail, passwordHash },
        select: { id: true },
      }),
    ]);
    firstUserId = first.id;
    secondUserId = second.id;
  });

  afterEach(async () => {
    const ids = [firstUserId, secondUserId].filter(Boolean);
    if (ids.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    firstUserId = '';
    secondUserId = '';
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      for (const key of ['DATABASE_URL', 'APP_URL', 'JWT_SECRET'] as const) {
        if (originalEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = originalEnv[key];
        }
      }
    }
  }, 20_000);

  it('lists only owned safe session fields and identifies the active cookie', async () => {
    const firstCookie = await login(firstEmail);
    const secondCookie = await login(firstEmail);
    const firstList = await listWithCookie(firstCookie);
    const secondList = await listWithCookie(secondCookie);

    expect(firstList).toHaveLength(2);
    expect(secondList).toHaveLength(2);
    expect(firstList.filter((session) => session.current)).toHaveLength(1);
    expect(secondList.filter((session) => session.current)).toHaveLength(1);

    const firstCurrent = firstList.find((session) => session.current);
    const secondCurrent = secondList.find((session) => session.current);
    expect(firstCurrent?.id).toEqual(expect.any(String));
    expect(secondCurrent?.id).toEqual(expect.any(String));
    expect(firstCurrent?.id).not.toBe(secondCurrent?.id);

    for (const session of firstList) {
      expect(Object.keys(session).sort()).toEqual([
        'createdAt',
        'current',
        'id',
        'lastActiveAt',
        'userAgent',
      ]);
      expect(session.createdAt).toEqual(expect.any(String));
      expect(session.lastActiveAt).toEqual(expect.any(String));
    }

    const persistedIds = await prisma.session.findMany({
      where: { userId: firstUserId },
      select: { id: true },
    });
    expect(firstList.map((session) => session.id).sort()).toEqual(
      persistedIds.map((session) => session.id).sort(),
    );
  });

  it('lists sessions over bearer authentication without a current cookie session', async () => {
    await login(firstEmail);
    const issued = await request(app.getHttpServer())
      .post('/auth/token')
      .send({ email: firstEmail, password })
      .expect(200);

    const accessToken = (issued.body as { accessToken: string }).accessToken;
    const response = await request(app.getHttpServer())
      .get('/auth/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    const sessions = response.body as VisibleSession[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.current).toBe(false);
    expect(sessions[0]?.id).toEqual(expect.any(String));
    expect(sessions[0]).not.toHaveProperty('userId');
    expect(sessions[0]).not.toHaveProperty('metadata');
    expect(sessions[0]).not.toHaveProperty('expiresAt');
  });

  it('does not disclose or revoke another user\'s sessions and invalidates an owned session', async () => {
    const firstCookie = await login(firstEmail);
    const secondCookie = await login(firstEmail);
    const otherCookie = await login(secondEmail);

    const firstList = await listWithCookie(firstCookie);
    const secondList = await listWithCookie(secondCookie);
    const otherList = await listWithCookie(otherCookie);
    const firstId = firstList.find((session) => session.current)?.id;
    const secondId = secondList.find((session) => session.current)?.id;
    const otherId = otherList.find((session) => session.current)?.id;

    expect(firstId).toEqual(expect.any(String));
    expect(secondId).toEqual(expect.any(String));
    expect(otherId).toEqual(expect.any(String));
    expect(otherList).toHaveLength(1);
    expect(firstList.map((session) => session.id)).not.toContain(otherId);

    await request(app.getHttpServer())
      .delete(`/auth/sessions/${secondId}`)
      .set('Cookie', otherCookie)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/auth/sessions/${otherId}`)
      .set('Cookie', firstCookie)
      .expect(404);

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', secondCookie)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/auth/sessions/${secondId}`)
      .set('Cookie', firstCookie)
      .expect(204);

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', secondCookie)
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/auth/sessions/${secondId}`)
      .set('Cookie', firstCookie)
      .expect(404);

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', firstCookie)
      .expect(200);
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', otherCookie)
      .expect(200);

    const remaining = await listWithCookie(firstCookie);
    expect(remaining.map((session) => session.id)).toEqual([firstId]);
  });
});
