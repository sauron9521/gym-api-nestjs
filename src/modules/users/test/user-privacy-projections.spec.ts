import { describe, expect, it } from 'vitest';

import {
  userSelect,
  userWithProfileSelect,
  userSelectWithCredentials,
  userAvatarKeySelect,
} from '../selects/user.select.js';

describe('Users public response Prisma projections', () => {
  const internalAccountKeys = [
    'passwordHash',
    'deletedAt',
    'sessions',
    'refreshTokens',
    'refreshTokenFamilies',
    'emailTokens',
  ] as const;

  it('never selects credentials, deletion state or authentication records for /users/me', () => {
    for (const field of internalAccountKeys) {
      expect(userSelect).not.toHaveProperty(field);
      expect(userWithProfileSelect).not.toHaveProperty(field);
    }
    expect(userWithProfileSelect).toMatchObject({
      id: true,
      email: true,
      role: true,
    });
  });

  it('excludes the managed avatar storage key and nested account data from the public profile', () => {
    const profile = userWithProfileSelect.profile.select;
    expect(profile).toMatchObject({
      firstName: true,
      lastName: true,
      displayName: true,
      avatarUrl: true,
      birthday: true,
      weight: true,
      timezone: true,
    });
    expect(profile).not.toHaveProperty('avatarKey');
    expect(profile).not.toHaveProperty('user');
    expect(profile).not.toHaveProperty('userId');
    expect(profile).not.toHaveProperty('createdAt');
  });

  it('keeps sensitive lookup projections separate from public account responses', () => {
    expect(userSelectWithCredentials.passwordHash).toBe(true);
    expect(userAvatarKeySelect.profile.select.avatarKey).toBe(true);
    expect(userSelect).not.toHaveProperty('profile');
    expect(userWithProfileSelect.profile.select).not.toHaveProperty('avatarKey');
    expect(userWithProfileSelect).not.toHaveProperty('passwordHash');
  });
});
