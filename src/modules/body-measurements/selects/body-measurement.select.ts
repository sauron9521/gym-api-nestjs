import type { Prisma } from '#prisma/client';

/** Public measurement data; omit userId and internal ownership fields. */
export const bodyMeasurementSelect = {
  id: true,
  measuredAt: true,
  weightKg: true,
  bodyFatPct: true,
  chestCm: true,
  waistCm: true,
  hipsCm: true,
  armCm: true,
  thighCm: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BodyMeasurementSelect;

/** Statistics endpoints never load notes, ownership or audit metadata. */
export const measurementStatisticsSelect = {
  id: true,
  measuredAt: true,
  weightKg: true,
  bodyFatPct: true,
  chestCm: true,
  waistCm: true,
  hipsCm: true,
  armCm: true,
  thighCm: true,
} satisfies Prisma.BodyMeasurementSelect;
