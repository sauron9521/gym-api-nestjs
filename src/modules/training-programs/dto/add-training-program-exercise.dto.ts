import { z } from 'zod';

import { trainingProgramNotesSchema } from './training-program.schemas.js';

export const addTrainingProgramExerciseSchema = z.strictObject({
  exerciseId: z.string().uuid(),
  notes: trainingProgramNotesSchema.nullable().optional(),
});

export type AddTrainingProgramExerciseDto = z.infer<
  typeof addTrainingProgramExerciseSchema
>;
