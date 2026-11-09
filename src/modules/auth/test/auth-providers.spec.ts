import type {
  AuthenticationRegistry,
  JwtClaims,
  SessionRecord,
} from '@nestjs/authentication';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsersRepository } from '#src/modules/users/repositories/users.repository';
import { JwtAuth } from '../providers/jwt-auth.provider.js';
import { SessionAuth } from '../providers/session-auth.provider.js';

describe('auth provider registration and user resolution contracts', () => {
  const repository = { findUserById: vi.fn() };
  const registry = { registerProvider: vi.fn() };

  let jwt: JwtAuth;
  let session: SessionAuth;

  beforeEach(() => {
    vi.resetAllMocks();
    session = new SessionAuth(
      repository as unknown as UsersRepository,
      registry as unknown as AuthenticationRegistry,
    );
    jwt = new JwtAuth(
      repository as unknown as UsersRepository,
      registry as unknown as AuthenticationRegistry,
    );
  });

  it('registers the session provider before JWT without colliding orders', () => {
    expect(registry.registerProvider).toHaveBeenNthCalledWith(1, session);
    expect(registry.registerProvider).toHaveBeenNthCalledWith(2, jwt, {
      order: 1,
    });
  });

  it('does not query a user for a JWT without a subject', () => {
    expect(jwt.validate({} as JwtClaims)).toBeNull();
    expect(repository.findUserById).not.toHaveBeenCalled();
  });

  it('resolves JWT subjects using the public, soft-delete-aware UsersRepository', async () => {
    const user = { id: 'user-1', role: 'ATHLETE' };
    repository.findUserById.mockResolvedValueOnce(user);

    await expect(jwt.validate({ sub: 'user-1' } as JwtClaims)).resolves.toEqual(user);
    expect(repository.findUserById).toHaveBeenCalledWith('user-1');

    repository.findUserById.mockResolvedValueOnce(null);
    await expect(jwt.validate({ sub: 'deleted-user' } as JwtClaims))
      .resolves.toBeNull();
  });

  it('resolves the session owner without querying credentials', async () => {
    const user = { id: 'session-user', role: 'ATHLETE' };
    repository.findUserById.mockResolvedValueOnce(user);
    const record = {
      id: 'session-1',
      userId: 'session-user',
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
      expiresAt: new Date('2026-10-08T10:00:00.000Z'),
      lastActiveAt: new Date('2026-10-01T10:00:00.000Z'),
    } satisfies SessionRecord;

    await expect(session.validate(record)).resolves.toEqual(user);
    expect(repository.findUserById).toHaveBeenCalledWith(record.userId);

    repository.findUserById.mockResolvedValueOnce(null);
    await expect(session.validate({ ...record, userId: 'deleted-user' }))
      .resolves.toBeNull();
  });
});
