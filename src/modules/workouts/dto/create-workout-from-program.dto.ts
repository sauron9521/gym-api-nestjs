import { z } from 'zod';

import { workoutDateSchema } from './workout.schemas.js';

export const createWorkoutFromProgramSchema = z.strictObject({
  assignmentId: z.string().uuid(),
  programWorkoutId: z.string().uuid(),
  scheduledAt: workoutDateSchema.nullable().optional(),
});

export type CreateWorkoutFromProgramDto = z.infer<
  typeof createWorkoutFromProgramSchema
>;
