import { describe, expect, it } from 'vitest';

import { ExercisesController } from '#src/modules/exercises/controllers/exercises.controller';
import { WorkoutsController } from '#src/modules/workouts/controllers/workouts.controller';
import { WorkoutAnalyticsController } from '#src/modules/workout-analytics/workout-analytics.controller';
import { AuthController } from '#src/modules/auth/controllers/auth.controller';

describe('Endpoint-aware throttling policies', () => {
  // Nest throttler stores method-level limits under this metadata key.
  const limitKey = 'THROTTLER:LIMITdefault';
  const ttlKey = 'THROTTLER:TTLdefault';

  it.each([
    [ExercisesController.prototype.findMany, 60],
    [ExercisesController.prototype.findOne, 60],
    [WorkoutsController.prototype.findMany, 60],
    [WorkoutsController.prototype.findOne, 60],
    [WorkoutAnalyticsController.prototype.summary, 20],
    [WorkoutAnalyticsController.prototype.exercise, 20],
    [AuthController.prototype.signIn, 3],
    [AuthController.prototype.signUp, 3],
  ])('defines the intended per-minute limit for %s', (handler, limit) => {
    expect(Reflect.getMetadata(limitKey, handler)).toBe(limit);
    expect(Reflect.getMetadata(ttlKey, handler)).toBe(60_000);
  });

  it('retains the global policy for workout mutations', () => {
    expect(Reflect.getMetadata(limitKey, WorkoutsController.prototype.create))
      .toBeUndefined();
    expect(Reflect.getMetadata(limitKey, WorkoutsController.prototype.updateSet))
      .toBeUndefined();
  });
});
