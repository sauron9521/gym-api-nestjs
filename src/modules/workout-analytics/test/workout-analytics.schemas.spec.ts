import { describe, expect, it } from 'vitest';

import {
  analyticsExerciseIdSchema,
  workoutAnalyticsQuerySchema,
} from '../dto/workout-analytics.schemas.js';

describe('Workout analytics input', () => {
  it('defaults to 30 calendar days', () => {
    expect(workoutAnalyticsQuerySchema.parse({})).toEqual({ range: '30d' });
  });

  it.each(['7d', '30d', '90d'])('supports %s', (range) => {
    expect(workoutAnalyticsQuerySchema.parse({ range })).toEqual({ range });
  });

  it.each([
    { range: '365d' },
    { range: '-7d' },
    { range: 'ALL' },
    { athleteId: 'other-athlete' },
    { range: ['7d', '90d'] },
  ])('rejects unsupported filters %j', (query) => {
    expect(workoutAnalyticsQuerySchema.safeParse(query).success).toBe(false);
  });

  it('requires a well-formed exercise UUID', () => {
    expect(analyticsExerciseIdSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});
