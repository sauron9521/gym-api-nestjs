import { z } from 'zod';

export const cancelTrainingProgramAssignmentSchema = z
  .strictObject({
    reason: z.string().trim().max(1000).nullable().optional(),
  })
  .optional();

export type CancelTrainingProgramAssignmentDto = z.infer<
  typeof cancelTrainingProgramAssignmentSchema
>;
