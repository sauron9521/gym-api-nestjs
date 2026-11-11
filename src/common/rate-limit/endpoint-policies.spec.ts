import { describe, expect, it } from 'vitest';

import { ExercisesController } from '#src/modules/exercises/controllers/exercises.controller';
import { WorkoutsController } from '#src/modules/workouts/controllers/workouts.controller';
import { WorkoutAnalyticsController } from '#src/modules/workout-analytics/controllers/workout-analytics.controller';
import { AuthController } from '#src/modules/auth/controllers/auth.controller';

describe('Endpoint-aware throttling policies', () => {
  // Nest throttler stores method-level limits under this metadata key.
  const limitKey = 'THROTTLER:LIMITdefault';
  const ttlKey = 'THROTTLER:TTLdefault';

  // Read the method's descriptor; these handlers are metadata targets, not
  // callbacks, and must never be invoked without their controller instance.
  it.each([
    [ExercisesController, 'findMany', 60],
    [ExercisesController, 'findOne', 60],
    [WorkoutsController, 'findMany', 60],
    [WorkoutsController, 'findOne', 60],
    [WorkoutAnalyticsController, 'summary', 20],
    [WorkoutAnalyticsController, 'exercise', 20],
    [AuthController, 'signIn', 3],
    [AuthController, 'signUp', 3],
  ] as const)('defines the intended per-minute limit for %s.%s', (controller, methodName, limit) => {
    const handler = Object.getOwnPropertyDescriptor(controller.prototype, methodName)?.value;
    expect(handler).toBeTypeOf('function');
    expect(Reflect.getMetadata(limitKey, handler)).toBe(limit);
    expect(Reflect.getMetadata(ttlKey, handler)).toBe(60_000);
  });

  it('retains the global policy for workout mutations', () => {
    for (const methodName of ['create', 'updateSet'] as const) {
      const handler = Object.getOwnPropertyDescriptor(
        WorkoutsController.prototype, methodName,
      )?.value;
      expect(handler).toBeTypeOf('function');
      expect(Reflect.getMetadata(limitKey, handler)).toBeUndefined();
    }
  });
});
