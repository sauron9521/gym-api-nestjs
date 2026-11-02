import { z } from 'zod';

import {
  trainingProgramDayNumberSchema,
  trainingProgramNotesSchema,
  trainingProgramTitleSchema,
  trainingProgramWeekNumberSchema,
} from './training-program.schemas.js';

export const createTrainingProgramWorkoutSchema = z.strictObject({
  weekNumber: trainingProgramWeekNumberSchema,
  dayNumber: trainingProgramDayNumberSchema,
  title: trainingProgramTitleSchema,
  notes: trainingProgramNotesSchema.nullable().optional(),
});

export type CreateTrainingProgramWorkoutDto = z.infer<
  typeof createTrainingProgramWorkoutSchema
>;
