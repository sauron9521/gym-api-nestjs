import { z } from 'zod';

import { exerciseIdSchema } from './exercise.schemas.js';

export const exerciseTrainerAccessIdSchema = exerciseIdSchema;

export const grantExerciseTrainerAccessSchema = z.strictObject({
  trainerId: exerciseTrainerAccessIdSchema,
});

export type GrantExerciseTrainerAccessDto = z.infer<
  typeof grantExerciseTrainerAccessSchema
>;
