import { z } from 'zod';

export const terminateTrainerAthleteSchema = z
  .strictObject({
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .optional();

export type TerminateTrainerAthleteDto = z.infer<
  typeof terminateTrainerAthleteSchema
>;
