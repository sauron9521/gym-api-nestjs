import { z } from 'zod';

export const trainingProgramIdSchema = z.string().uuid();
export const trainingProgramVersionIdSchema = z.string().uuid();
export const trainingProgramWorkoutIdSchema = z.string().uuid();
export const trainingProgramExerciseIdSchema = z.string().uuid();
export const trainingProgramSetIdSchema = z.string().uuid();

export const trainingProgramStatusSchema = z.enum([
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED',
]);

export const trainingProgramVersionStatusSchema = z.enum([
  'DRAFT',
  'PUBLISHED',
]);

export const trainingProgramSetTypeSchema = z.enum([
  'WARMUP',
  'WORKING',
  'DROP_SET',
  'AMRAP',
]);

export const trainingProgramTitleSchema = z.string().trim().min(2).max(120);

export const trainingProgramDescriptionSchema = z.string().trim().max(5000);

export const trainingProgramNotesSchema = z.string().trim().max(5000);

export const trainingProgramDurationWeeksSchema = z
  .number()
  .int()
  .min(1)
  .max(52);

export const trainingProgramWeekNumberSchema = z.number().int().min(1).max(52);

export const trainingProgramDayNumberSchema = z.number().int().min(1).max(7);

export const trainingProgramWeightSchema = z
  .number()
  .finite()
  .min(0)
  .max(999999.99)
  .multipleOf(0.01);

export const trainingProgramDistanceSchema = z
  .number()
  .finite()
  .min(0)
  .max(99999999.99)
  .multipleOf(0.01);

export const trainingProgramRepsSchema = z.number().int().min(1).max(1000);

export const trainingProgramDurationSchema = z
  .number()
  .int()
  .min(1)
  .max(604800);

export const trainingProgramRestSchema = z.number().int().min(0).max(86400);

// Match PostgreSQL Decimal(3,1); never silently round targets.
export const trainingProgramRpeSchema = z.number().finite().min(1).max(10).multipleOf(0.1);

export const trainingProgramRirSchema = z.number().int().min(0).max(10);

export const trainingProgramAssignmentIdSchema = z.string().uuid();

export const trainingProgramAssignmentStatusSchema = z.enum([
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'TERMINATED',
]);
