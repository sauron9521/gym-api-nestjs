import type { Prisma } from '#prisma/client';

import type { trainingProgramSelect } from '../selects/training-program.select.js';
import type { trainingProgramVersionSelect } from '../selects/training-program-version.select.js';
import type { trainingProgramDraftAccessSelect } from '../selects/training-program-access.select.js';
import type { trainingProgramVersionListSelect } from '../selects/training-program-query.select.js';

import type {
  trainingProgramAssignmentSelect,
  trainingProgramAssignmentDetailsSelect,
  trainingProgramAssignmentSummarySelect,
  trainingProgramAssignmentHistoricalSelect,
} from '../selects/training-program-assignment.select.js';

export type TrainingProgramPayload = Prisma.TrainingProgramGetPayload<{
  select: typeof trainingProgramSelect;
}>;

export type TrainingProgramVersionPayload =
  Prisma.TrainingProgramVersionGetPayload<{
    select: typeof trainingProgramVersionSelect;
  }>;

export type TrainingProgramAssignmentPayload =
  Prisma.TrainingProgramAssignmentGetPayload<{
    select: typeof trainingProgramAssignmentSelect;
  }>;

export type TrainingProgramAssignmentSummaryPayload =
  Prisma.TrainingProgramAssignmentGetPayload<{
    select: typeof trainingProgramAssignmentSummarySelect;
  }>;

export type TrainingProgramAssignmentDetailsPayload =
  Prisma.TrainingProgramAssignmentGetPayload<{
    select: typeof trainingProgramAssignmentDetailsSelect;
  }>;

/** Compact read models, derived from their actual Prisma select constants. */
export type TrainingProgramVersionListItemPayload =
  Prisma.TrainingProgramVersionGetPayload<{
    select: typeof trainingProgramVersionListSelect;
  }>;

export type TrainingProgramDraftAccessPayload =
  Prisma.TrainingProgramVersionGetPayload<{
    select: typeof trainingProgramDraftAccessSelect;
  }>;

export type TrainingProgramAssignmentHistoricalPayload =
  Prisma.TrainingProgramAssignmentGetPayload<{
    select: typeof trainingProgramAssignmentHistoricalSelect;
  }>;
