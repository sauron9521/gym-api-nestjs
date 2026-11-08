import { z } from 'zod';

import { metricKeys } from './body-measurement.schemas.js';

/** An explicit metric ensures missing values do not distort trends. */
export const bodyMeasurementMetricSchema = z.enum(metricKeys);
export type BodyMeasurementMetric = z.infer<typeof bodyMeasurementMetricSchema>;

export const statisticsRangeSchema = z.enum(['7d', '30d', '90d']);
export type StatisticsRange = z.infer<typeof statisticsRangeSchema>;

export const bodyMeasurementStatisticsQuerySchema = z.strictObject({
  metric: bodyMeasurementMetricSchema.default('weightKg'),
  range: statisticsRangeSchema.default('90d'),
});

export type BodyMeasurementStatisticsQueryDto = z.infer<
  typeof bodyMeasurementStatisticsQuerySchema
>;

export const statisticsRangeDays: Record<StatisticsRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export const statisticsUnits: Record<BodyMeasurementMetric, string> = {
  weightKg: 'kg',
  bodyFatPct: '%',
  chestCm: 'cm',
  waistCm: 'cm',
  hipsCm: 'cm',
  armCm: 'cm',
  thighCm: 'cm',
};
