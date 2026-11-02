import { z } from 'zod';

export const createTrainingProgramAssignmentSchema = z.strictObject({
  trainerAthleteId: z.string().uuid(),
});

export type CreateTrainingProgramAssignmentDto = z.infer<
  typeof createTrainingProgramAssignmentSchema
>;
