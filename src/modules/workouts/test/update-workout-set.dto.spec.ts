import { describe, expect, it } from 'vitest';

import { updateWorkoutSetSchema } from '../dto/update-workout-set.dto.js';

describe('updateWorkoutSetSchema: skipped metrics', () => {
  it.each([
    { actualReps: 8 },
    { actualWeightKg: 60 },
    { actualDurationSeconds: 30 },
    { actualDistanceMeters: 100 },
    { rpe: 8 },
    { rir: 2 },
  ])('rejects actual performance values for SKIPPED: %j', (metric) => {
    expect(
      updateWorkoutSetSchema.safeParse({ status: 'SKIPPED', ...metric }).success,
    ).toBe(false);
  });

  it('allows explicit null metrics on a skipped set', () => {
    expect(
      updateWorkoutSetSchema.safeParse({
        status: 'SKIPPED',
        actualReps: null,
        actualWeightKg: null,
        rpe: null,
        rir: null,
      }).success,
    ).toBe(true);
  });

  it('continues to accept actual RPE/RIR on completed sets', () => {
    expect(
      updateWorkoutSetSchema.safeParse({
        status: 'COMPLETED',
        actualReps: 8,
        rpe: 8,
        rir: 2,
      }).success,
    ).toBe(true);
  });
});
