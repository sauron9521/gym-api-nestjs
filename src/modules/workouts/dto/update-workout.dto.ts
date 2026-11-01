import { z } from 'zod';

import { workoutDateSchema } from './workout.schemas.js';

export const updateWorkoutSchema = z
  .strictObject({
    title: z.string().trim().min(2).max(120).optional(),

    notes: z.string().trim().max(5000).nullable().optional(),

    scheduledAt: workoutDateSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateWorkoutDto = z.infer<typeof updateWorkoutSchema>;
