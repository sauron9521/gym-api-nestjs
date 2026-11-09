import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  grantExerciseTrainerAccessSchema,
} from '../dto/exercise-trainer-access.dto.js';

describe('grantExerciseTrainerAccessSchema', () => {
  it('accepts a valid trainer ID', () => {
    const trainerId = randomUUID();
    expect(grantExerciseTrainerAccessSchema.parse({ trainerId }))
      .toEqual({ trainerId });
  });

  it.each([
    {},
    { trainerId: 'not-a-uuid' },
    { trainerId: randomUUID(), role: 'ADMIN' },
    { trainerId: null },
  ])('rejects malformed or mass-assignment payload: %j', (body) => {
    expect(grantExerciseTrainerAccessSchema.safeParse(body).success)
      .toBe(false);
  });
});
