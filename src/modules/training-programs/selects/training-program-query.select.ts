import type { Prisma } from '#prisma/client';

/** Public version-list projection: deliberately omits the nested draft tree. */
export const trainingProgramVersionListSelect = {
  id: true,
  programId: true,
  version: true,
  title: true,
  description: true,
  durationWeeks: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrainingProgramVersionSelect;

/** Minimal order checks inside the locked draft editing transaction. */
export const trainingProgramExerciseOrderSelect = {
  id: true,
  sortOrder: true,
} satisfies Prisma.TrainingProgramExerciseSelect;

export const trainingProgramSetOrderSelect = {
  id: true,
  setNumber: true,
} satisfies Prisma.TrainingProgramSetSelect;
