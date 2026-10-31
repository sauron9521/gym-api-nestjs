import { z } from 'zod';

export const exerciseTypeSchema = z.enum([
  'STRENGTH',
  'CARDIO',
  'MOBILITY',
  'PLYOMETRIC',
  'OTHER',
]);

export const exerciseVisibilitySchema = z.enum([
  'PRIVATE',
  'SELECTED_TRAINERS',
]);

export const muscleRoleSchema = z.enum(['PRIMARY', 'SECONDARY']);

export const exerciseMuscleGroupSchema = z.strictObject({
  slug: z.string().trim().min(1).max(80),
  role: muscleRoleSchema,
});

export const exerciseEquipmentSchema = z.string().trim().min(1).max(80);

export const exerciseIdSchema = z.string().uuid();
