import { z } from 'zod';

import {
  trainingProgramDescriptionSchema,
  trainingProgramDurationWeeksSchema,
  trainingProgramTitleSchema,
} from './training-program.schemas.js';

export const updateTrainingProgramDraftSchema = z
  .strictObject({
    title: trainingProgramTitleSchema.optional(),
    description: trainingProgramDescriptionSchema.nullable().optional(),
    durationWeeks: trainingProgramDurationWeeksSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateTrainingProgramDraftDto = z.infer<
  typeof updateTrainingProgramDraftSchema
>;
