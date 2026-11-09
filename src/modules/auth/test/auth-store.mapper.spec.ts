import { describe, expect, it } from 'vitest';
import { toSessionRecord } from '../mappers/auth-session.mapper.js';
import {
  toEmailTokenRecord,
  toRefreshTokenRecord,
} from '../mappers/auth-token.mapper.js';

const createdAt = new Date('2026-10-01T10:00:00.000Z');
const expiresAt = new Date('2026-10-08T10:00:00.000Z');

describe('Authentication persistence mappers', () => {
  it('projects only session contract fields and omits optional nulls', () => {
    const source = {
      id: 'session-1',
      userId: 'user-1',
      createdAt,
      expiresAt,
      lastActiveAt: createdAt,
      mfa: null,
      metadata: null,
    };

    expect(toSessionRecord(source)).toEqual({
      id: 'session-1',
      userId: 'user-1',
      createdAt,
      expiresAt,
      lastActiveAt: createdAt,
    });
    expect(toSessionRecord({ ...source, mfa: 'verified', metadata: { ip: '127.0.0.1' } }))
      .toEqual({
        id: 'session-1',
        userId: 'user-1',
        createdAt,
        expiresAt,
        lastActiveAt: createdAt,
        mfa: 'verified',
        metadata: { ip: '127.0.0.1' },
      });
  });

  it('does not leak persistence-only revoked flags into refresh token records', () => {
    const source = {
      id: 'refresh-1',
      familyId: 'family-1',
      userId: 'user-1',
      createdAt,
      expiresAt,
      familyExpiresAt: expiresAt,
      usedAt: null,
      claims: null,
      revoked: true,
    };

    expect(toRefreshTokenRecord(source)).toEqual({
      id: 'refresh-1',
      familyId: 'family-1',
      userId: 'user-1',
      createdAt,
      expiresAt,
      familyExpiresAt: expiresAt,
    });
    expect(toRefreshTokenRecord({
      ...source,
      usedAt: createdAt,
      claims: { amr: ['pwd'] },
    })).toEqual({
      id: 'refresh-1',
      familyId: 'family-1',
      userId: 'user-1',
      createdAt,
      expiresAt,
      familyExpiresAt: expiresAt,
      usedAt: createdAt,
      claims: { amr: ['pwd'] },
    });
  });

  it('maps the atomic SQL-consumed email token and preserves optional fingerprint semantics', () => {
    const row = {
      id: 'email-1',
      purpose: 'password-reset',
      userId: 'user-1',
      email: 'example@example.test',
      fingerprint: null,
      createdAt,
      expiresAt,
    };

    expect(toEmailTokenRecord(row)).toEqual({
      id: row.id,
      purpose: 'password-reset',
      userId: row.userId,
      email: row.email,
      createdAt,
      expiresAt,
    });
    expect(toEmailTokenRecord({ ...row, fingerprint: 'sha256:abc' })).toEqual({
      id: row.id,
      purpose: 'password-reset',
      userId: row.userId,
      email: row.email,
      fingerprint: 'sha256:abc',
      createdAt,
      expiresAt,
    });
  });
});
