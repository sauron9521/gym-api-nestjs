import { z } from 'zod';

export const reorderTrainingProgramSetsSchema = z.strictObject({
  setIds: z.array(z.string().uuid()).max(100),
});

export type ReorderTrainingProgramSetsDto = z.infer<
  typeof reorderTrainingProgramSetsSchema
>;
