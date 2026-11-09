import type { Prisma } from '#prisma/client';

export type VolumeValue = Prisma.Decimal | number | string;

/** PostgreSQL aggregate rows. Counts are cast to int in SQL. */
export type WorkoutAnalyticsDailyRow = {
  date: string;
  workoutCount: number;
  completedSets: number;
  strengthVolumeKg: VolumeValue;
};

export type ExerciseAnalyticsDailyRow = WorkoutAnalyticsDailyRow & {
  strengthReps: number;
  bestWeightKg: VolumeValue | null;
};

export type ExerciseSnapshotRow = {
  name: string;
};
