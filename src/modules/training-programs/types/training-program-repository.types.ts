import type { Prisma } from '#prisma/client';

/** Pagination and database filters shared by the repositories. */
export type FindManyTrainingProgramsParams = {
  where: Prisma.TrainingProgramWhereInput;
  skip: number;
  take: number;
  orderBy?: Prisma.TrainingProgramOrderByWithRelationInput[];
};

export type FindManyTrainingProgramAssignmentsParams = {
  where: Prisma.TrainingProgramAssignmentWhereInput;
  skip: number;
  take: number;
  orderBy?: Prisma.TrainingProgramAssignmentOrderByWithRelationInput[];
  view?: 'full' | 'summary';
};
