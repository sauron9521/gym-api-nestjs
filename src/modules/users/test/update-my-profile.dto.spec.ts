import { updateMyProfileSchema } from '../dto/update-my-profile.dto.js';

describe('updateMyProfileSchema', () => {
  it('accepts partial updates and explicit null clearing', () => {
    expect(updateMyProfileSchema.parse({
      name: '  Athlete  ',
      weight: null,
    })).toEqual({ name: 'Athlete', weight: null });
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
