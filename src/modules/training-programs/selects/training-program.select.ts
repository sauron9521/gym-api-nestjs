import { Prisma } from '#prisma/client';

export const trainingProgramSelect = {
  id: true,
  trainerId: true,
  status: true,

  versions: {
    orderBy: {
      version: 'desc',
    },
    take: 1,
    select: {
      id: true,
      version: true,
      title: true,
      description: true,
      durationWeeks: true,
      status: true,
      publishedAt: true,
    },
  },

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrainingProgramSelect;
