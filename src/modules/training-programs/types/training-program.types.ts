import type {
  Role,
  TrainingProgramAssignmentStatus,
  TrainingProgramStatus,
  WorkoutSetType,
} from '../../../generated/prisma/client.js';

export type TrainingProgramActor = {
  id: string;
  role: Role;
};

export type CreateTrainingProgramInput = {
  title: string;
  description?: string | null;
  durationWeeks?: number | null;
};

export type UpdateTrainingProgramDraftInput = {
  title?: string;
  description?: string | null;
  durationWeeks?: number | null;
};

export type TrainingProgramListQuery = {
  page: number;
  limit: number;
  status?: TrainingProgramStatus;
};

export type CreateTrainingProgramWorkoutInput = {
  weekNumber: number;
  dayNumber: number;
  title: string;
  notes?: string | null;
};

export type UpdateTrainingProgramWorkoutInput = {
  weekNumber?: number;
  dayNumber?: number;
  title?: string;
  notes?: string | null;
};
export type AddTrainingProgramExerciseInput = {
  exerciseId: string;
  notes?: string | null;
};

export type UpdateTrainingProgramExerciseInput = {
  notes?: string | null;
};

export type ReorderTrainingProgramExercisesInput = {
  exerciseIds: string[];
};

export type CreateTrainingProgramSetInput = {
  setType?: WorkoutSetType;
  plannedReps?: number | null;
  plannedWeightKg?: number | null;
  plannedDurationSeconds?: number | null;
  plannedDistanceMeters?: number | null;
  restSeconds?: number | null;
  targetRpe?: number | null;
  targetRir?: number | null;
  notes?: string | null;
};

export type UpdateTrainingProgramSetInput =
  Partial<CreateTrainingProgramSetInput>;

export type ReorderTrainingProgramSetsInput = {
  setIds: string[];
};

export type CreateTrainingProgramAssignmentInput = {
  trainerAthleteId: string;
};

export type TrainingProgramAssignmentListQuery = {
  page: number;
  limit: number;
  status?: TrainingProgramAssignmentStatus;
  view?: 'full' | 'summary';
};

export type CancelTrainingProgramAssignmentInput = {
  reason?: string | null;
};
