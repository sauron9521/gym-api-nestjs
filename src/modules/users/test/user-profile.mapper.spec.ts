import { describe, expect, it } from 'vitest';
import type { UserWithProfilePayload } from '../types/user-payload.types.js';
import {
  mapProfileUpdateInput,
  mapUserWithProfile,
} from '../mappers/user-profile.mapper.js';

describe('user profile mappers', () => {
  it('preserves the nullable profile and safe public fields', () => {
    const user = {
      id: 'user-1',
      email: 'user@example.test',
      profile: null,
    } as UserWithProfilePayload;

    expect(mapUserWithProfile(user)).toEqual(user);
    expect(mapUserWithProfile(user).profile).toBeNull();
  });

  it('converts date-only birthdays and decimal weights without leaking secrets', () => {
    const user = {
      id: 'user-1',
      email: 'user@example.test',
      profile: {
        birthday: new Date('1998-03-04T00:00:00.000Z'),
        weight: { toString: () => '21.50' },
        name: 'Athlete',
      },
    } as unknown as UserWithProfilePayload;

    const response = mapUserWithProfile(user);
    expect(response.profile?.birthday).toBe('1998-03-04');
    expect(response.profile?.weight).toBe(21.5);
    expect(response.profile?.name).toBe('Athlete');
    expect(response).not.toHaveProperty('passwordHash');
  });

  it('keeps nullable birthday and weight values unchanged', () => {
    const user = {
      id: 'user-1',
      profile: { birthday: null, weight: null },
    } as unknown as UserWithProfilePayload;
    expect(mapUserWithProfile(user).profile).toMatchObject({
      birthday: null,
      weight: null,
    });
  });

  it('maps legacy name to displayName and normalizes birthday for Prisma', () => {
    const result = mapProfileUpdateInput({
      name: 'Athlete',
      birthday: '1998-03-04',
      weight: 21.5,
    });
    expect(result).toMatchObject({
      name: 'Athlete',
      displayName: 'Athlete',
      birthday: new Date('1998-03-04T00:00:00.000Z'),
      weight: 21.5,
    });
  });

  it('prefers displayName and preserves explicit null clearing', () => {
    expect(mapProfileUpdateInput({
      name: 'Old name',
      displayName: null,
      birthday: null,
      weight: null,
    })).toMatchObject({
      name: null,
      displayName: null,
      birthday: null,
      weight: null,
    });
  });

  it('does not change other profile fields during partial updates', () => {
    expect(mapProfileUpdateInput({ timezone: 'Europe/Kyiv' })).toEqual({
      name: undefined,
      displayName: undefined,
      firstName: undefined,
      lastName: undefined,
      avatarUrl: undefined,
      timezone: 'Europe/Kyiv',
      birthday: undefined,
      height: undefined,
      weight: undefined,
    });
  });
});
