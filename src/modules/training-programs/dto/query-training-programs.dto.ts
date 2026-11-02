import { z } from 'zod';

import { trainingProgramStatusSchema } from './training-program.schemas.js';

export const queryTrainingProgramsSchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: trainingProgramStatusSchema.optional(),
});

export type QueryTrainingProgramsDto = z.infer<
  typeof queryTrainingProgramsSchema
>;
