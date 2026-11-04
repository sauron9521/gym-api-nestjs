import { z } from 'zod';

export const reorderTrainingProgramExercisesSchema = z.strictObject({
  exerciseIds: z.array(z.string().uuid()).max(100),
});

export type ReorderTrainingProgramExercisesDto = z.infer<
  typeof reorderTrainingProgramExercisesSchema
>;
