import type { Prisma } from '#prisma/client';

/** Full participant projection for active/pending relationships and athlete history. */
export const trainerAthleteSelect = {
  id: true,
  trainerId: true,
  athleteId: true,
  initiatedById: true,
  status: true,

  respondedAt: true,
  endedAt: true,
  endedById: true,
  endReason: true,

  trainer: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  athlete: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  initiatedBy: {
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

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrainerAthleteSelect;

/** Restricted projection for a former trainer: excludes account email. */
export const trainerAthleteHistoricalSelect = {
  id: true,
  trainerId: true,
  athleteId: true,
  initiatedById: true,
  status: true,
  respondedAt: true,
  endedAt: true,
  endedById: true,
  endReason: true,

  trainer: {
    select: {
      id: true,
      role: true,
    },
  },

  athlete: {
    select: {
      id: true,
      role: true,
    },
  },

  initiatedBy: {
    select: {
      id: true,
      role: true,
    },
  },

  endedBy: {
    select: {
      id: true,
      role: true,
    },
  },

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrainerAthleteSelect;
