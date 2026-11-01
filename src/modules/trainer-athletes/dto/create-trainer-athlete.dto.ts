import { z } from 'zod';

export const createTrainerAthleteSchema = z.strictObject({
  userId: z.string().uuid(),
});

export type CreateTrainerAthleteDto = z.infer<
  typeof createTrainerAthleteSchema
>;
