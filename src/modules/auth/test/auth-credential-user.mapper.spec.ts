import { describe, expect, it } from 'vitest';

import { toAuthenticatedUser } from '../mappers/auth-credential-user.mapper.js';

describe('authenticated identity public projection', () => {
  const row = {
    id: 'user-1',
    email: 'athlete@example.test',
    emailVerified: true,
    role: 'ATHLETE' as const,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-02T10:00:00.000Z'),
    passwordHash: 'sensitive-hash',
    internalSecret: 'should never be returned',
  };

  it('returns only the existing public user fields', () => {
    const result = toAuthenticatedUser(row);

    expect(result).toEqual({
      id: row.id,
      email: row.email,
      emailVerified: row.emailVerified,
      role: row.role,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    expect(Object.keys(result).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerified',
      'id',
      'role',
      'updatedAt',
    ]);
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('internalSecret');
  });

  it('does not mutate the credential lookup result', () => {
    const original = { ...row };
    toAuthenticatedUser(row);
    expect(row).toEqual(original);
  });
});
