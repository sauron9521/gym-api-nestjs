import { updateMyProfileSchema } from '../dto/update-my-profile.dto.js';

describe('updateMyProfileSchema', () => {
  it('accepts partial updates and explicit null clearing', () => {
    expect(updateMyProfileSchema.parse({
      name: '  Athlete  ',
      weight: null,
    })).toEqual({ name: 'Athlete', weight: null });
  });

  it('accepts names, HTTPS avatar and IANA timezone', () => {
    const result = updateMyProfileSchema.parse({
      firstName: '  Anna  ',
      lastName: '  Smith ',
      displayName: '  Anna S. ',
      avatarUrl: 'https://cdn.example.com/profile/avatar.png',
      timezone: 'Europe/Kyiv',
    });
    expect(result).toEqual({
      firstName: 'Anna',
      lastName: 'Smith',
      displayName: 'Anna S.',
      avatarUrl: 'https://cdn.example.com/profile/avatar.png',
      timezone: 'Europe/Kyiv',
    });
    expect(updateMyProfileSchema.safeParse({ timezone: 'UTC' }).success)
      .toBe(true);
  });

  it('supports clearing nullable profile data but not timezone', () => {
    expect(updateMyProfileSchema.safeParse({
      firstName: null, lastName: null, displayName: null, avatarUrl: null,
    }).success).toBe(true);
    expect(updateMyProfileSchema.safeParse({ timezone: null }).success)
      .toBe(false);
  });

  it('rejects unsafe avatar URLs and invalid time zones', () => {
    for (const avatarUrl of [
      'http://example.com/photo.jpg',
      'file:///etc/passwd',
      'https://user:password@example.com/photo.jpg',
      'not-a-url',
    ]) {
      expect(updateMyProfileSchema.safeParse({ avatarUrl }).success)
        .toBe(false);
    }
    for (const timezone of ['GMT+02:00', 'Europe/NotARealCity', '', 'Invalid']) {
      expect(updateMyProfileSchema.safeParse({ timezone }).success)
        .toBe(false);
    }
  });

  it('rejects mismatching legacy name and displayName', () => {
    expect(updateMyProfileSchema.safeParse({
      name: 'Anna', displayName: 'Different',
    }).success).toBe(false);
    expect(updateMyProfileSchema.safeParse({
      name: 'Anna', displayName: 'Anna',
    }).success).toBe(true);
  });

  it('rejects empty payloads and unexpected account fields', () => {
    expect(updateMyProfileSchema.safeParse({}).success).toBe(false);
    for (const key of ['email', 'role', 'passwordHash', 'userId']) {
      expect(updateMyProfileSchema.safeParse({ [key]: 'invalid' }).success)
        .toBe(false);
    }
  });

  it('rejects invalid or future birthdays', () => {
    for (const birthday of ['1998-02-30', '2100-01-01', '1998-03-04T00:00:00Z']) {
      expect(updateMyProfileSchema.safeParse({ birthday }).success)
        .toBe(false);
    }
  });

  it('accepts body weight with two fractional digits', () => {
    for (const weight of [21.5, 81.25, 105.75, 81]) {
      expect(updateMyProfileSchema.safeParse({ weight }).success).toBe(true);
    }
  });

  it('rejects invalid metrics and excessive decimal precision', () => {
    for (const body of [
      { height: 0 }, { height: 350 }, { height: 193.5 },
      { weight: 0 }, { weight: 80.555 }, { weight: 601 },
    ]) {
      expect(updateMyProfileSchema.safeParse(body).success).toBe(false);
    }
  });
});
