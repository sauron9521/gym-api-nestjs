import type {
  Role,
  TrainingProgramStatus,
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
