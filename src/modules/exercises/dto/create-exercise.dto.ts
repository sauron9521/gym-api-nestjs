import { z } from 'zod';

import {
  exerciseTypeSchema,
  exerciseVisibilitySchema,
  exerciseMuscleGroupSchema,
  exerciseEquipmentSchema,
} from './exercise.schemas.js';

export const createExerciseSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),

  description: z.string().trim().max(5000).optional(),

  instructions: z.string().trim().max(10000).optional(),

  exerciseType: exerciseTypeSchema.default('STRENGTH'),

  visibility: exerciseVisibilitySchema.optional(),

  muscleGroups: z.array(exerciseMuscleGroupSchema).min(1).max(10),

  equipment: z.array(exerciseEquipmentSchema).max(20).default([]),
});

export type CreateExerciseDto = z.infer<typeof createExerciseSchema>;
