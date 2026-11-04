import { Prisma } from '../../../generated/prisma/client.js';
import { trainingProgramVersionSelect } from './training-program-version.select.js';

export const trainingProgramAssignmentSelect = {
  id: true,

  versionId: true,
  trainerAthleteId: true,

  athleteId: true,
  assignedById: true,

  status: true,

  assignedAt: true,
  startedAt: true,
  completedAt: true,

  endedAt: true,
  endedById: true,
  endReason: true,

  version: {
    select: {
      id: true,
      programId: true,
      version: true,
      title: true,
      description: true,
      durationWeeks: true,
      status: true,
      publishedAt: true,

      program: {
        select: {
          id: true,
          trainerId: true,
          status: true,
        },
      },
    },
  },

  trainerAthlete: {
    select: {
      id: true,
      trainerId: true,
      athleteId: true,
      status: true,
    },
  },

  athlete: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  assignedBy: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  endedBy: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  workouts: {
    select: {
      id: true,
      title: true,
      status: true,
      scheduledAt: true,
      startedAt: true,
      completedAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  },

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrainingProgramAssignmentSelect;

export const trainingProgramAssignmentDetailsSelect = {
  ...trainingProgramAssignmentSelect,

  version: {
    select: {
      ...trainingProgramVersionSelect,

      program: {
        select: {
          id: true,
          trainerId: true,
          status: true,
        },
      },
    },
  },
} satisfies Prisma.TrainingProgramAssignmentSelect;
