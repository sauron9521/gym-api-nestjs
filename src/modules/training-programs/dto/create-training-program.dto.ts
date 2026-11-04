import { z } from 'zod';

import {
  trainingProgramDescriptionSchema,
  trainingProgramDurationWeeksSchema,
  trainingProgramTitleSchema,
} from './training-program.schemas.js';

export const createTrainingProgramSchema = z.strictObject({
  title: trainingProgramTitleSchema,
  description: trainingProgramDescriptionSchema.nullable().optional(),
  durationWeeks: trainingProgramDurationWeeksSchema.nullable().optional(),
});

export type CreateTrainingProgramDto = z.infer<
  typeof createTrainingProgramSchema
>;
