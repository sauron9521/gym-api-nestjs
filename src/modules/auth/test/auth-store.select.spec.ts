import { describe, expect, it } from 'vitest';
import { authSessionSelect } from '../selects/auth-session.select.js';
import {
  authPendingEmailTokenCutoffSelect,
  authRefreshTokenFamilyRevocationSelect,
  authRefreshTokenSelect,
  authRevokedRefreshTokenSelect,
} from '../selects/auth-token.select.js';

describe('Auth store Prisma projections', () => {
  it('limits sessions to authentication contract fields', () => {
    expect(Object.keys(authSessionSelect).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'id',
      'lastActiveAt',
      'metadata',
      'mfa',
      'userId',
    ]);
    expect(authSessionSelect).not.toHaveProperty('user');
  });

  it('does not fetch revoked flag or token families from refresh-token lookup', () => {
    expect(Object.keys(authRefreshTokenSelect).sort()).toEqual([
      'claims',
      'createdAt',
      'expiresAt',
      'familyExpiresAt',
      'familyId',
      'id',
      'usedAt',
      'userId',
    ]);
    expect(authRefreshTokenSelect).not.toHaveProperty('revoked');
  });

  it('uses minimal selects for revocation checks and email pending quota', () => {
    expect(authRefreshTokenFamilyRevocationSelect).toEqual({ revokedAt: true });
    expect(authRevokedRefreshTokenSelect).toEqual({ id: true });
    expect(authPendingEmailTokenCutoffSelect).toEqual({ id: true, expiresAt: true });
  });
});
