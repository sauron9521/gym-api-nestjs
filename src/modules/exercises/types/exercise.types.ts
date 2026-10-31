import type {
  ExerciseType,
  ExerciseVisibility,
  MuscleRole,
  Role,
} from '../../../generated/prisma/client.js';

export type ExerciseActor = {
  id: string;
  role: Role;
};

export type ExerciseMuscleInput = {
  slug: string;
  role: MuscleRole;
};

export type CreateExerciseInput = {
  name: string;
  description?: string;
  instructions?: string;
  exerciseType?: ExerciseType;

  visibility?: ExerciseVisibility;
  trainerIds?: string[];

  muscleGroups: ExerciseMuscleInput[];
  equipment: string[];
};

export type UpdateExerciseInput = {
  name?: string;
  description?: string | null;
  instructions?: string | null;
  exerciseType?: ExerciseType;

  visibility?: ExerciseVisibility;
  muscleGroups?: ExerciseMuscleInput[];
  equipment?: string[];
};

export type ExerciseListQuery = {
  page: number;
  limit: number;
  search?: string;
  muscleGroup?: string;
  equipment?: string;
  exerciseType?: ExerciseType;
};

export type ExerciseAccessContext = {
  activeTrainerIds: string[];
  activeAthleteIds: string[];
};
