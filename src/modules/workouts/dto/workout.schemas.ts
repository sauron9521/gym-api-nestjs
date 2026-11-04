import { z } from 'zod';

export const workoutIdSchema = z.string().uuid();
export const workoutSetIdSchema = z.string().uuid();

export const workoutStatusSchema = z.enum([
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);

export const workoutSetTypeSchema = z.enum([
  'WARMUP',
  'WORKING',
  'DROP_SET',
  'AMRAP',
]);

export const workoutSetUpdateStatusSchema = z.enum(['COMPLETED', 'SKIPPED']);

export const workoutDateSchema = z.coerce.date();

export const workoutWeightSchema = z.number().finite().min(0).max(999999.99);

export const workoutDistanceSchema = z
  .number()
  .finite()
  .min(0)
  .max(99999999.99);

export const workoutRepsSchema = z.number().int().min(1).max(1000);

export const workoutDurationSchema = z.number().int().min(1).max(604800);

export const workoutRestSchema = z.number().int().min(0).max(86400);

export const workoutRpeSchema = z.number().finite().min(1).max(10);

export const workoutRirSchema = z.number().int().min(0).max(10);

export const createWorkoutSetSchema = z.strictObject({
  setType: workoutSetTypeSchema.optional(),

  plannedReps: workoutRepsSchema.nullable().optional(),
  plannedWeightKg: workoutWeightSchema.nullable().optional(),
  plannedDurationSeconds: workoutDurationSchema.nullable().optional(),
  plannedDistanceMeters: workoutDistanceSchema.nullable().optional(),

  restSeconds: workoutRestSchema.nullable().optional(),
  targetRpe: workoutRpeSchema.nullable().optional(),
  targetRir: workoutRirSchema.nullable().optional(),
});

export const createWorkoutExerciseSchema = z.strictObject({
  exerciseId: z.string().uuid(),
  notes: z.string().trim().max(5000).nullable().optional(),
  sets: z.array(createWorkoutSetSchema).min(1).max(100),
});
