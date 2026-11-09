import { z } from 'zod';

import { workoutDateSchema, workoutStatusSchema } from './workout.schemas.js';

export const queryWorkoutsSchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(100).default(20),

  status: workoutStatusSchema.optional(),

  view: z.enum(['summary', 'full']).optional(),

  scheduledFrom: workoutDateSchema.optional(),

  scheduledTo: workoutDateSchema.optional(),
});

export type QueryWorkoutsDto = z.infer<typeof queryWorkoutsSchema>;
