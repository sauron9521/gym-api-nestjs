import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticationStorage, MfaState } from '@nestjs/authentication';
import { PrismaSessionStore } from '../stores/index.js';
import { PrismaService } from '../../../prisma/index.js';

describe('PrismaSessionStore', () => {
  const prisma = {
    session: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
  };

  const storage = {
    registerSource: vi.fn(),
  };

  let store: PrismaSessionStore;

  const session = {
    id: 'a'.repeat(64),
    userId: 'user-123',
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    expiresAt: new Date('2026-10-08T10:00:00.000Z'),
    lastActiveAt: new Date('2026-10-01T10:00:00.000Z'),
    mfa: 'verified' as MfaState,
    metadata: { ip: '127.0.0.1' },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    prisma.session.findUnique.mockResolvedValue(null);
    prisma.session.create.mockResolvedValue(session);
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
    prisma.session.deleteMany.mockResolvedValue({ count: 1 });
    prisma.session.findMany.mockResolvedValue([]);

    store = new PrismaSessionStore(
      prisma as unknown as PrismaService,
      storage as unknown as AuthenticationStorage,
    );
  });

  it('registers itself as the session store', () => {
    expect(storage.registerSource).toHaveBeenCalledWith({
      sessions: store,
    });
  });

  it('returns undefined when the session does not exist', async () => {
    prisma.session.findUnique.mockResolvedValue(null);

    await expect(store.getSession(session.id)).resolves.toBeUndefined();
  });

  it('returns a session without null optional fields', async () => {
    prisma.session.findUnique.mockResolvedValue({
      ...session,
      mfa: null,
      metadata: null,
    });

    const result = await store.getSession(session.id);

    expect(result).toEqual({
      id: session.id,
      userId: session.userId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastActiveAt: session.lastActiveAt,
    });
    expect(result).not.toHaveProperty('mfa');
    expect(result).not.toHaveProperty('metadata');
    expect(result).not.toHaveProperty('extra');
  });

  it('creates a session without persisting extra', async () => {
    await store.createSession({
      ...session,
      extra: { user: { id: session.userId } },
    });

    expect(prisma.session.create).toHaveBeenCalledWith({
      data: {
        id: session.id,
        userId: session.userId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        lastActiveAt: session.lastActiveAt,
        mfa: 'verified',
        metadata: { ip: '127.0.0.1' },
      },
    });
  });

  it('touches only when the new timestamp is later', async () => {
    const lastActiveAt = new Date('2026-10-01T11:00:00.000Z');

    await store.touchSession(session.id, lastActiveAt);

    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: {
        id: session.id,
        lastActiveAt: { lt: lastActiveAt },
      },
      data: { lastActiveAt },
    });
  });

  it('returns true when a session is deleted', async () => {
    prisma.session.deleteMany.mockResolvedValue({ count: 1 });

    await expect(store.deleteSession(session.id)).resolves.toBe(true);
  });

  it('returns false when the session was already deleted', async () => {
    prisma.session.deleteMany.mockResolvedValue({ count: 0 });

    await expect(store.deleteSession(session.id)).resolves.toBe(false);
  });

  it('lists sessions for the requested user without filtering expired sessions', async () => {
    prisma.session.findMany.mockResolvedValue([session]);

    const result = await store.listUserSessions(session.userId);

    expect(prisma.session.findMany).toHaveBeenCalledWith({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(session.id);
  });

  it('deletes all sessions for the requested user', async () => {
    await store.deleteUserSessions(session.userId);

    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: session.userId },
    });
  });
});
