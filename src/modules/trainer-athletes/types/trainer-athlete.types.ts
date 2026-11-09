import type {
  Role,
  TrainerAthleteStatus,
} from '#prisma/client';

export type TrainerAthleteActor = {
  id: string;
  role: Role;
};

export type CreateTrainerAthleteInput = {
  userId: string;
};

export type TrainerAthleteListQuery = {
  page: number;
  limit: number;
  status?: TrainerAthleteStatus;
};

export type TerminateTrainerAthleteInput = {
  reason?: string | null;
};
