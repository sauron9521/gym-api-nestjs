import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PasswordHasher } from '@nestjs/authentication';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/index.js';

describe('Authentication sessions (HTTP + PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordHasher: PasswordHasher;

  let userId: string | undefined;
  let email: string;
  const password = 'StrongPassword123!';

  beforeAll(async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL;

    if (!testDatabaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL must point to a dedicated test database.',
      );
    }

    let databaseName: string;

    try {
      databaseName = decodeURIComponent(
        new URL(testDatabaseUrl).pathname.slice(1),
      );
    } catch {
      throw new Error('TEST_DATABASE_URL is not a valid database URL.');
    }

    if (!databaseName.toLowerCase().includes('test')) {
      throw new Error(
        'Refusing to run integration tests: database name must contain "test".',
      );
    }

    // Set the test DB before Nest initializes Prisma.
    process.env.DATABASE_URL = testDatabaseUrl;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    passwordHasher = app.get(PasswordHasher);

    email = `session-e2e-${randomUUID()}@example.com`;

    const passwordHash = await passwordHasher.hash(password);

    const user = await prisma.user.create({
      data: { email, passwordHash },
      select: { id: true },
    });

    userId = user.id;
  }, 20_000);

  afterAll(async () => {
    try {
      if (prisma && userId) {
        // Remove sessions first so cleanup does not depend on FK behavior.
        await prisma.session.deleteMany({
          where: { userId },
        });

        await prisma.user.deleteMany({
          where: { id: userId },
        });
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('rejects an existing session after the user is soft-deleted', async () => {
    if (!userId) {
      throw new Error('Test user was not initialized.');
    }

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/sing-in')
      .send({ email, password });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body).toEqual({ mfaRequired: false });

    const rawSetCookie = loginResponse.headers['set-cookie'];

    const setCookies: string[] = Array.isArray(rawSetCookie)
      ? rawSetCookie
      : rawSetCookie
        ? [rawSetCookie]
        : [];

    const sessionCookie = setCookies
      .map((cookie) => cookie.split(';', 1)[0] ?? '')
      .find((cookie) => cookie.startsWith('__Host-sid='));

    if (!sessionCookie) {
      throw new Error('Session cookie __Host-sid was not set after login.');
    }

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body).toEqual({ mfaRequired: false });
    expect(loginResponse.headers['set-cookie']).toBeDefined();

    // 2. Verify the session was actually persisted in PostgreSQL.
    const sessions = await prisma.session.findMany({
      where: { userId },
    });

    expect(sessions.length).toBeGreaterThan(0);

    // 3. The authenticated user can access a protected endpoint.
    const beforeDelete = await request(app.getHttpServer())
      .get('/')
      .set('Cookie', sessionCookie);

    expect(beforeDelete.status).toBe(200);

    // 4. Soft-delete the user without physically deleting the record.
    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });

    const savedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });

    expect(savedUser).not.toBeNull();
    expect(savedUser?.deletedAt).toBeInstanceOf(Date);

    // 5. The old cookie must no longer authorize the user.
    const afterDelete = await request(app.getHttpServer())
      .get('/')
      .set('Cookie', sessionCookie);

    expect([401, 403]).toContain(afterDelete.status);
  }, 20_000);
});
