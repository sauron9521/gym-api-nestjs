import { z } from 'zod';

import {
  trainingProgramDistanceSchema,
  trainingProgramDurationSchema,
  trainingProgramNotesSchema,
  trainingProgramRepsSchema,
  trainingProgramRestSchema,
  trainingProgramRirSchema,
  trainingProgramRpeSchema,
  trainingProgramSetTypeSchema,
  trainingProgramWeightSchema,
} from './training-program.schemas.js';

export const updateTrainingProgramSetSchema = z
  .strictObject({
    setType: trainingProgramSetTypeSchema.optional(),

    plannedReps: trainingProgramRepsSchema.nullable().optional(),
    plannedWeightKg: trainingProgramWeightSchema.nullable().optional(),
    plannedDurationSeconds: trainingProgramDurationSchema.nullable().optional(),
    plannedDistanceMeters: trainingProgramDistanceSchema.nullable().optional(),

    restSeconds: trainingProgramRestSchema.nullable().optional(),

    targetRpe: trainingProgramRpeSchema.nullable().optional(),
    targetRir: trainingProgramRirSchema.nullable().optional(),

    notes: trainingProgramNotesSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateTrainingProgramSetDto = z.infer<
  typeof updateTrainingProgramSetSchema
>;
