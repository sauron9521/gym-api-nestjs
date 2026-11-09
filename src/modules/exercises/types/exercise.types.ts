import type {
  Prisma,
  ExerciseType,
  ExerciseVisibility,
  MuscleRole,
  Role,
} from '#prisma/client';
import type {
  archivedExerciseSelect,
  exerciseSelect,
  workoutExerciseReferenceSelect,
} from '../selects/exercise.select.js';

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

/** Strongly typed Prisma projections shared with module services and callers. */
export type ExerciseRecord = Prisma.ExerciseGetPayload<{
  select: typeof exerciseSelect;
}>;

export type ArchivedExerciseRecord = Prisma.ExerciseGetPayload<{
  select: typeof archivedExerciseSelect;
}>;

export type WorkoutExerciseReference = Prisma.ExerciseGetPayload<{
  select: typeof workoutExerciseReferenceSelect;
}>;

export type FindManyExercisesParams = {
  where?: Prisma.ExerciseWhereInput;
  skip: number;
  take: number;
  orderBy?: Prisma.ExerciseOrderByWithRelationInput[];
};
