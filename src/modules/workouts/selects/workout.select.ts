import type { Prisma } from '#prisma/client';

/** Public workout response: no internal idempotency keys or fingerprints. */
export const workoutSetSelect = {
  id: true,
  workoutExerciseId: true,
  setNumber: true,
  setType: true,
  status: true,

  plannedReps: true,
  plannedWeightKg: true,
  plannedDurationSeconds: true,
  plannedDistanceMeters: true,

  actualReps: true,
  actualWeightKg: true,
  actualDurationSeconds: true,
  actualDistanceMeters: true,

  restSeconds: true,
  targetRpe: true,
  targetRir: true,
  rpe: true,
  rir: true,

  completedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkoutSetSelect;

export const workoutSelect = {
  id: true,
  title: true,
  notes: true,
  athleteId: true,
  createdById: true,
  status: true,
  scheduledAt: true,
  startedAt: true,
  completedAt: true,
  programAssignmentId: true,
  programWorkoutId: true,

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
      createdAt: true,
      updatedAt: true,

      sets: {
        orderBy: { setNumber: 'asc' },
        select: workoutSetSelect,
      },
    },
  },

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkoutSelect;

/** Private idempotency lookup never used in HTTP projections. */
export const workoutIdempotencySelect = {
  id: true,
  idempotencyFingerprint: true,
} satisfies Prisma.WorkoutSelect;

/** Minimal state lookup for atomic workout completion. */
export const workoutSetStatusSelect = {
  status: true,
} satisfies Prisma.WorkoutSetSelect;

/** Parent reference for assignment-aware workout starts. */
export const workoutStartReferenceSelect = {
  id: true,
  programAssignmentId: true,
} satisfies Prisma.WorkoutSelect;
