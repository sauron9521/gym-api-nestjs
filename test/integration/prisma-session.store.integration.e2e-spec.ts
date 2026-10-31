import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuthenticationStorage, SessionRecord } from '@nestjs/authentication';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaSessionStore } from '../../src/modules/auth/stores/prisma-session.store.js';
import { PrismaModule, PrismaService } from '../../src/prisma/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

describe('PrismaSessionStore integration (e2e)', () => {
  let app: INestApplication;
  let store: PrismaSessionStore;
  let prisma: PrismaService;
  let userId: string;

  const createdSessionIds: string[] = [];

  async function createSession(
    overrides: Partial<SessionRecord> = {},
  ): Promise<SessionRecord> {
    const now = new Date();

    const record: SessionRecord = {
      id: randomUUID().replaceAll('-', '').repeat(2),
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      lastActiveAt: now,
      ...overrides,
    };

    await store.createSession(record);
    createdSessionIds.push(record.id);

    return record;
  }

  beforeAll(async () => {
    useTestDatabase();
    // const testDatabaseUrl = process.env.TEST_DATABASE_URL;
    //
    // if (!testDatabaseUrl) {
    //   throw new Error(
    //     'TEST_DATABASE_URL must point to a dedicated test database.',
    //   );
    // }
    //
    // let databaseName: string;
    //
    // try {
    //   databaseName = decodeURIComponent(
    //     new URL(testDatabaseUrl).pathname.slice(1),
    //   );
    // } catch {
    //   throw new Error('TEST_DATABASE_URL is not a valid database URL.');
    // }
    //
    // if (!databaseName.toLowerCase().includes('test')) {
    //   throw new Error(
    //     'Refusing to run integration tests: database name must contain "test".',
    //   );
    // }
    //
    // process.env.DATABASE_URL = testDatabaseUrl;

    const moduleRef = await Test.createTestingModule({
      imports: [await ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
      providers: [
        PrismaSessionStore,
        {
          provide: AuthenticationStorage,
          useValue: {
            registerSource: () => undefined,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    store = app.get(PrismaSessionStore);
    prisma = app.get(PrismaService);

    const user = await prisma.user.create({
      data: {
        email: `session-store-${randomUUID()}@example.com`,
        passwordHash: 'test-password-hash',
      },
      select: { id: true },
    });

    userId = user.id;
  }, 20_000);

  afterAll(async () => {
    try {
      if (prisma) {
        if (createdSessionIds.length > 0) {
          await prisma.session.deleteMany({
            where: { id: { in: createdSessionIds } },
          });
        }

        if (userId) {
          await prisma.user.deleteMany({
            where: { id: userId },
          });
        }
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  }, 20_000);

  it('creates and reads a session from PostgreSQL', async () => {
    const record = await createSession();

    const result = await store.getSession(record.id);

    expect(result).toEqual(record);
  });

  it('returns undefined for a missing session', async () => {
    await expect(
      store.getSession(randomUUID().replaceAll('-', '').repeat(2)),
    ).resolves.toBeUndefined();
  });

  it('persists optional MFA and metadata fields', async () => {
    const record = await createSession({
      mfa: 'verified',
      metadata: { ip: '127.0.0.1' },
    });

    const result = await store.getSession(record.id);

    expect(result?.mfa).toBe('verified');
    expect(result?.metadata).toEqual({ ip: '127.0.0.1' });
  });

  it('updates lastActiveAt only when the new timestamp is later', async () => {
    const record = await createSession();
    const newerTime = new Date(record.lastActiveAt.getTime() + 60_000);
    const olderTime = new Date(record.lastActiveAt.getTime() - 60_000);

    await store.touchSession(record.id, newerTime);
    await store.touchSession(record.id, olderTime);

    const result = await store.getSession(record.id);

    expect(result?.lastActiveAt.getTime()).toBe(newerTime.getTime());
  });

  it('does not recreate a session when touching a deleted session', async () => {
    const record = await createSession();

    await store.deleteSession(record.id);
    await store.touchSession(
      record.id,
      new Date(record.lastActiveAt.getTime() + 60_000),
    );

    await expect(store.getSession(record.id)).resolves.toBeUndefined();
  });

  it('returns true on the first delete and false on the second', async () => {
    const record = await createSession();

    await expect(store.deleteSession(record.id)).resolves.toBe(true);
    await expect(store.deleteSession(record.id)).resolves.toBe(false);
  });

  it('deletes only sessions belonging to the requested user', async () => {
    const first = await createSession();
    const second = await createSession();

    await store.deleteUserSessions(userId);

    expect(await store.getSession(first.id)).toBeUndefined();
    expect(await store.getSession(second.id)).toBeUndefined();

    const otherUser = await prisma.user.create({
      data: {
        email: `session-other-${randomUUID()}@example.com`,
        passwordHash: 'test-password-hash',
      },
      select: { id: true },
    });

    let otherSessionId: string | undefined;

    try {
      const now = new Date();
      const otherSession: SessionRecord = {
        id: randomUUID().replaceAll('-', '').repeat(2),
        userId: otherUser.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        lastActiveAt: now,
      };

      await store.createSession(otherSession);
      otherSessionId = otherSession.id;

      await store.deleteUserSessions(userId);

      expect(await store.getSession(otherSession.id)).toEqual(otherSession);
    } finally {
      if (otherSessionId) {
        await prisma.session.deleteMany({
          where: { id: otherSessionId },
        });
      }

      await prisma.user.deleteMany({
        where: { id: otherUser.id },
      });
    }
  });

  it('allows only one concurrent delete to report success', async () => {
    const record = await createSession();

    const results = await Promise.all([
      store.deleteSession(record.id),
      store.deleteSession(record.id),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => !result)).toHaveLength(1);
  });
});
