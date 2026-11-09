import type { Prisma } from '#prisma/client';

import type {
  bodyMeasurementSelect,
  measurementStatisticsSelect,
} from '../selects/body-measurement.select.js';

/** Input for the repository, distinct from HTTP DTOs. */
export type MeasurementChanges = Partial<{
  weightKg: number | null;
  bodyFatPct: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  armCm: number | null;
  thighCm: number | null;
  notes: string | null;
  measuredAt: Date;
}>;

export type MeasurementRecord = Prisma.BodyMeasurementGetPayload<{
  select: typeof bodyMeasurementSelect;
}>;

export type MeasurementStatisticsRecord = Prisma.BodyMeasurementGetPayload<{
  select: typeof measurementStatisticsSelect;
}>;

/** Fixed, parameterized UTC-day series returned by the statistics query. */
export type DailyMetricRecord = {
  id: string;
  measuredAt: Date;
  value: Prisma.Decimal;
};

/** HTTP metrics deliberately serialize Prisma Decimal as JSON numbers. */
export type MeasurementResponse = Omit<
  MeasurementRecord,
  | 'weightKg'
  | 'bodyFatPct'
  | 'chestCm'
  | 'waistCm'
  | 'hipsCm'
  | 'armCm'
  | 'thighCm'
> & {
  weightKg: number | null;
  bodyFatPct: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  armCm: number | null;
  thighCm: number | null;
};

export type MetricPoint = {
  id: string;
  measuredAt: Date;
  value: number;
};

export type MetricDifference = {
  delta: number | null;
  percentChange: number | null;
};
