import { Prisma } from '../../../generated/prisma/client.js';

export const trainingProgramVersionSelect = {
  id: true,
  programId: true,
  version: true,

  title: true,
  description: true,
  durationWeeks: true,

  status: true,
  publishedAt: true,

  workouts: {
    orderBy: [{ weekNumber: 'asc' }, { dayNumber: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      versionId: true,

      weekNumber: true,
      dayNumber: true,

      title: true,
      notes: true,

      exercises: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          workoutId: true,
          exerciseId: true,

          exerciseNameSnapshot: true,
          exerciseTypeSnapshot: true,

          sortOrder: true,
          notes: true,

          sets: {
            orderBy: {
              setNumber: 'asc',
            },
            select: {
              id: true,
              programExerciseId: true,

              setNumber: true,
              setType: true,

              plannedReps: true,
              plannedWeightKg: true,
              plannedDurationSeconds: true,
              plannedDistanceMeters: true,

              restSeconds: true,
              targetRpe: true,
              targetRir: true,

              notes: true,
            },
          },

          createdAt: true,
          updatedAt: true,
        },
      },

      createdAt: true,
      updatedAt: true,
    },
  },

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrainingProgramVersionSelect;
