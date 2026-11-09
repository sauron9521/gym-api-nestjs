import type {
  Prisma,
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

import type {
  trainerAthleteSelect,
  trainerAthleteHistoricalSelect,
} from '../selects/trainer-athlete.select.js';

/** Prisma-derived selected records (not repository ReturnType aliases). */
export type TrainerAthleteRecord = Prisma.TrainerAthleteGetPayload<{
  select: typeof trainerAthleteSelect;
}>;

export type TrainerAthleteHistoricalRecord = Prisma.TrainerAthleteGetPayload<{
  select: typeof trainerAthleteHistoricalSelect;
}>;

export type FindManyTrainerAthletesParams = {
  where: Prisma.TrainerAthleteWhereInput;
  skip: number;
  take: number;
  orderBy?: Prisma.TrainerAthleteOrderByWithRelationInput[];
};
