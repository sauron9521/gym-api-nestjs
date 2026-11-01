import { z } from 'zod';

import {
  createWorkoutExerciseSchema,
  workoutDateSchema,
} from './workout.schemas.js';

export const createWorkoutSchema = z.strictObject({
  title: z.string().trim().min(2).max(120),

  notes: z.string().trim().max(5000).nullable().optional(),

  scheduledAt: workoutDateSchema.nullable().optional(),

  exercises: z.array(createWorkoutExerciseSchema).min(1).max(50),
});

export type CreateWorkoutDto = z.infer<typeof createWorkoutSchema>;
