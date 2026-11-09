import type {
  WorkoutSetType,
  WorkoutStatus,
} from '#prisma/client';

import type { ExerciseActor } from '#src/modules/exercises/types/exercise.types';

export type WorkoutActor = ExerciseActor;

export type CreateWorkoutSetInput = {
  setType?: WorkoutSetType;

  plannedReps?: number | null;
  plannedWeightKg?: number | null;
  plannedDurationSeconds?: number | null;
  plannedDistanceMeters?: number | null;

  restSeconds?: number | null;
  targetRpe?: number | null;
  targetRir?: number | null;
};

export type CreateWorkoutExerciseInput = {
  exerciseId: string;
  notes?: string | null;
  sets: CreateWorkoutSetInput[];
};

export type CreateWorkoutInput = {
  title: string;
  notes?: string | null;
  scheduledAt?: Date | null;
  exercises: CreateWorkoutExerciseInput[];
};

export type UpdateWorkoutInput = {
  title?: string;
  notes?: string | null;
  scheduledAt?: Date | null;
};

export type UpdateWorkoutSetInput = {
  status: 'COMPLETED' | 'SKIPPED';

  actualReps?: number | null;
  actualWeightKg?: number | null;
  actualDurationSeconds?: number | null;
  actualDistanceMeters?: number | null;

  restSeconds?: number | null;
  rpe?: number | null;
  rir?: number | null;

  notes?: string | null;
};

export type WorkoutListQuery = {
  page: number;
  limit: number;
  status?: WorkoutStatus;
  scheduledFrom?: Date;
  scheduledTo?: Date;
};

export type CreateWorkoutFromProgramInput = {
  assignmentId: string;
  programWorkoutId: string;
  scheduledAt?: Date | null;
};
