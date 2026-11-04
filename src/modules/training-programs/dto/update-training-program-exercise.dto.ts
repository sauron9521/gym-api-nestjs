import { z } from 'zod';

import { trainingProgramNotesSchema } from './training-program.schemas.js';

export const updateTrainingProgramExerciseSchema = z
  .strictObject({
    notes: trainingProgramNotesSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateTrainingProgramExerciseDto = z.infer<
  typeof updateTrainingProgramExerciseSchema
>;
