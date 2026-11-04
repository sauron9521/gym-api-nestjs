import { z } from 'zod';

import {
  trainingProgramDayNumberSchema,
  trainingProgramNotesSchema,
  trainingProgramTitleSchema,
  trainingProgramWeekNumberSchema,
} from './training-program.schemas.js';

export const updateTrainingProgramWorkoutSchema = z
  .strictObject({
    weekNumber: trainingProgramWeekNumberSchema.optional(),
    dayNumber: trainingProgramDayNumberSchema.optional(),
    title: trainingProgramTitleSchema.optional(),
    notes: trainingProgramNotesSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateTrainingProgramWorkoutDto = z.infer<
  typeof updateTrainingProgramWorkoutSchema
>;
