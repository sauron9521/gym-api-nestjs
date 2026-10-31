import { z } from 'zod';
import { exerciseTypeSchema } from './exercise.schemas.js';

export const queryExercisesSchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(100).default(20),

  search: z.string().trim().max(100).optional(),

  muscleGroup: z.string().trim().min(1).max(80).optional(),

  equipment: z.string().trim().min(1).max(80).optional(),

  exerciseType: exerciseTypeSchema.optional(),
});

export type QueryExercisesDto = z.infer<typeof queryExercisesSchema>;
