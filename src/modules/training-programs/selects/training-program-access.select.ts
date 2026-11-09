import { Prisma } from '../../../infra/database/generated/prisma/client.js';

/**
 * The draft editor needs IDs/order only. Do not load descriptions, planned
 * weights or other large workout fields for permission/existence checks.
 * Full version details still use trainingProgramVersionSelect.
 */
export const trainingProgramDraftAccessSelect = {
  id: true,
  status: true,
  durationWeeks: true,
  workouts: {
    select: {
      id: true,
      exercises: {
        select: {
          id: true,
          sortOrder: true,
          sets: {
            select: {
              id: true,
              setNumber: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.TrainingProgramVersionSelect;
