import type { Prisma } from '#prisma/client';

/** Public exercise response including stable relations, excluding access grants. */
export const exerciseSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  instructions: true,
  source: true,
  visibility: true,
  exerciseType: true,
  createdById: true,
  isArchived: true,
  copiedFromExerciseId: true,

  muscleGroups: {
    select: {
      role: true,
      muscleGroup: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  },

  equipment: {
    select: {
      equipment: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  },

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ExerciseSelect;

/** Archive response must not accidentally include full exercise data. */
export const archivedExerciseSelect = {
  id: true,
  isArchived: true,
  updatedAt: true,
} satisfies Prisma.ExerciseSelect;

/** Minimal snapshot fields for workouts; do not load full exercise relations. */
export const workoutExerciseReferenceSelect = {
  id: true,
  name: true,
  exerciseType: true,
} satisfies Prisma.ExerciseSelect;

/** Lookup projections for validating create/update exercise relations. */
export const muscleGroupLookupSelect = {
  id: true,
  name: true,
  slug: true,
} satisfies Prisma.MuscleGroupSelect;

export const equipmentLookupSelect = {
  id: true,
  name: true,
  slug: true,
} satisfies Prisma.EquipmentSelect;
