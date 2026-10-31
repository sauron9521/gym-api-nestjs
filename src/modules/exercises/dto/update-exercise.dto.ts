import { z } from 'zod';

import {
  exerciseTypeSchema,
  exerciseVisibilitySchema,
  exerciseMuscleGroupSchema,
  exerciseEquipmentSchema,
} from './exercise.schemas.js';

export const updateExerciseSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),

    description: z.string().trim().max(5000).nullable().optional(),

    instructions: z.string().trim().max(10000).nullable().optional(),

    exerciseType: exerciseTypeSchema.optional(),

    visibility: exerciseVisibilitySchema.optional(),

    muscleGroups: z.array(exerciseMuscleGroupSchema).min(1).max(10).optional(),

    equipment: z.array(exerciseEquipmentSchema).max(20).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateExerciseDto = z.infer<typeof updateExerciseSchema>;
