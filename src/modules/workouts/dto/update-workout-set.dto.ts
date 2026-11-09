import { z } from 'zod';

import {
  workoutDistanceSchema,
  workoutDurationSchema,
  workoutRestSchema,
  workoutRepsSchema,
  workoutRirSchema,
  workoutRpeSchema,
  workoutSetUpdateStatusSchema,
  workoutWeightSchema,
} from './workout.schemas.js';

export const updateWorkoutSetSchema = z
  .strictObject({
    status: workoutSetUpdateStatusSchema,

    actualReps: workoutRepsSchema.nullable().optional(),
    actualWeightKg: workoutWeightSchema.nullable().optional(),
    actualDurationSeconds: workoutDurationSchema.nullable().optional(),
    actualDistanceMeters: workoutDistanceSchema.nullable().optional(),

    restSeconds: workoutRestSchema.nullable().optional(),
    rpe: workoutRpeSchema.nullable().optional(),
    rir: workoutRirSchema.nullable().optional(),

    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.status === 'SKIPPED' &&
      [
        data.actualReps,
        data.actualWeightKg,
        data.actualDurationSeconds,
        data.actualDistanceMeters,
        data.rpe,
        data.rir,
      ].some((value) => value !== undefined && value !== null)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'A skipped set cannot contain actual performance values',
        path: ['status'],
      });
    }
  });

export type UpdateWorkoutSetDto = z.infer<typeof updateWorkoutSetSchema>;
