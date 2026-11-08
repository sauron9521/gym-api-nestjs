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

  it('rejects out-of-range and non-integer metrics', () => {
    for (const body of [{ height: 0 }, { height: 350 }, { weight: 0 }, { weight: 72.5 }]) {
      expect(updateMyProfileSchema.safeParse(body).success).toBe(false);
    }
  });
});
