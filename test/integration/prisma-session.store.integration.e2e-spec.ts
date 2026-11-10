import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuthenticationStorage, SessionRecord } from '@nestjs/authentication';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaSessionStore } from '../../src/modules/auth/stores/index.js';
import { PrismaModule, PrismaService } from '../../src/infra/database/index.js';
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

  it('deletes sessions expired before or exactly at the cutoff but retains later expiry', async () => {
    const cutoff = new Date('2026-11-10T12:00:00.000Z');
    const createdAt = new Date(cutoff.getTime() - 120_000);

    const before = await createSession({
      createdAt,
      lastActiveAt: createdAt,
      expiresAt: new Date(cutoff.getTime() - 1),
    });
    const exactly = await createSession({
      createdAt,
      lastActiveAt: createdAt,
      expiresAt: cutoff,
    });
    const after = await createSession({
      createdAt,
      lastActiveAt: createdAt,
      expiresAt: new Date(cutoff.getTime() + 1),
    });

    await store.deleteExpiredSessions(cutoff);

    const remaining = await prisma.session.findMany({
      where: { id: { in: [before.id, exactly.id, after.id] } },
      select: { id: true, expiresAt: true },
    });

    expect(remaining).toEqual([
      { id: after.id, expiresAt: after.expiresAt },
    ]);

    // Daily cleanup can be retried safely without removing a live session.
    await store.deleteExpiredSessions(cutoff);
    expect(
      await prisma.session.count({ where: { id: after.id } }),
    ).toBe(1);
  });

  it('removes expired sessions across owners without touching active sessions or users', async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: `session-expiration-other-${randomUUID()}@example.test`,
        passwordHash: 'test-password-hash',
      },
      select: { id: true },
    });

    const cutoff = new Date('2026-11-10T12:00:00.000Z');
    const createdAt = new Date(cutoff.getTime() - 120_000);
    const ownExpired = await createSession({
      createdAt,
      lastActiveAt: createdAt,
      expiresAt: new Date(cutoff.getTime() - 1),
    });
    const ownLive = await createSession({
      createdAt,
      lastActiveAt: createdAt,
      expiresAt: new Date(cutoff.getTime() + 60_000),
    });
    const otherExpired: SessionRecord = {
      id: randomUUID().replaceAll('-', '').repeat(2),
      userId: otherUser.id,
      createdAt,
      lastActiveAt: createdAt,
      expiresAt: cutoff,
    };
    const otherLive: SessionRecord = {
      ...otherExpired,
      id: randomUUID().replaceAll('-', '').repeat(2),
      expiresAt: new Date(cutoff.getTime() + 60_000),
    };

    try {
      await store.createSession(otherExpired);
      await store.createSession(otherLive);
      await store.deleteExpiredSessions(cutoff);

      const sessions = await prisma.session.findMany({
        where: {
          id: {
            in: [ownExpired.id, ownLive.id, otherExpired.id, otherLive.id],
          },
        },
        select: { id: true },
      });
      expect(sessions.map((session) => session.id).sort()).toEqual(
        [ownLive.id, otherLive.id].sort(),
      );
      expect(
        await prisma.user.count({
          where: { id: { in: [userId, otherUser.id] } },
        }),
      ).toBe(2);
    } finally {
      await prisma.user.delete({ where: { id: otherUser.id } });
    }
  });
});
