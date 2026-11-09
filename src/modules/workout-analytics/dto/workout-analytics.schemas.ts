import { z } from 'zod';

export const workoutAnalyticsRangeSchema = z.enum(['7d', '30d', '90d']);
export type WorkoutAnalyticsRange = z.infer<typeof workoutAnalyticsRangeSchema>;

export const workoutAnalyticsQuerySchema = z.strictObject({
  range: workoutAnalyticsRangeSchema.default('30d'),
});

export type WorkoutAnalyticsQuery = z.infer<typeof workoutAnalyticsQuerySchema>;

export const workoutAnalyticsRangeDays: Record<WorkoutAnalyticsRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export const analyticsExerciseIdSchema = z.string().uuid();
