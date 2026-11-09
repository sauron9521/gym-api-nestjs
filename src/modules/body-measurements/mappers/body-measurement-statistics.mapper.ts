import type { BodyMeasurementMetric } from '../dto/body-measurement-statistics.schemas.js';
import type {
  MeasurementStatisticsRecord,
  MetricDifference,
  MetricPoint,
} from '../types/body-measurement.types.js';

export function mapMetricPoint(
  record: MeasurementStatisticsRecord | null,
  metric: BodyMeasurementMetric,
): MetricPoint | null {
  const value = record?.[metric];
  if (!record || value === null || value === undefined) return null;

  return {
    id: record.id,
    measuredAt: record.measuredAt,
    value: Number(value),
  };
}

/** Includes zero baseline protection for valid 0% body fat readings. */
export function getMetricDifference(
  from: MetricPoint | null,
  to: MetricPoint | null,
): MetricDifference {
  if (!from || !to) {
    return { delta: null, percentChange: null };
  }

  const delta = Number((to.value - from.value).toFixed(2));
  return {
    delta,
    percentChange:
      from.value === 0
        ? null
        : Number(((delta / from.value) * 100).toFixed(2)),
  };
}
