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
