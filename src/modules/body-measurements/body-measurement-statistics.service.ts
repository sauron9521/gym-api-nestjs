import { Injectable } from '@nestjs/common';

import {
  BodyMeasurementStatisticsRepository,
  type MeasurementStatisticsRecord,
} from './body-measurement-statistics.repository.js';
import {
  statisticsRangeDays,
  statisticsUnits,
  type BodyMeasurementMetric,
  type BodyMeasurementStatisticsQueryDto,
} from './dto/body-measurement-statistics.schemas.js';

type Point = {
  id: string;
  measuredAt: Date;
  value: number;
};

function toPoint(
  record: MeasurementStatisticsRecord | null,
  metric: BodyMeasurementMetric,
): Point | null {
  const value = record?.[metric];
  if (!record || value === null || value === undefined) return null;
  return { id: record.id, measuredAt: record.measuredAt, value: Number(value) };
}

function getDifference(from: Point | null, to: Point | null) {
  if (!from || !to) {
    return { delta: null, percentChange: null };
  }
  const delta = Number((to.value - from.value).toFixed(2));
  return {
    delta,
    // Zero body-fat baseline is valid; a percent change cannot divide by it.
    percentChange:
      from.value === 0
        ? null
        : Number(((delta / from.value) * 100).toFixed(2)),
  };
}

@Injectable()
export class BodyMeasurementStatisticsService {
  constructor(private readonly repository: BodyMeasurementStatisticsRepository) {}

  async getStatistics(
    userId: string,
    query: BodyMeasurementStatisticsQueryDto,
  ) {
    const asOf = new Date();
    const { first, latest, baselines, series } =
      await this.repository.readStatistics(
        userId, query.metric, asOf, statisticsRangeDays[query.range],
      );
    const firstPoint = toPoint(first, query.metric);
    const latestPoint = toPoint(latest, query.metric);

    const changes = Object.fromEntries(
      (['7d', '30d', '90d'] as const).map((range) => {
        const baseline = toPoint(baselines[range], query.metric);
        const cutoff = asOf.getTime() -
          statisticsRangeDays[range] * 86_400_000;
        const recent = latestPoint &&
          latestPoint.measuredAt.getTime() >= cutoff
          ? latestPoint : null;
        return [
          range,
          {
            baseline,
            ...getDifference(baseline, recent),
          },
        ];
      }),
    );

    return {
      metric: query.metric,
      unit: statisticsUnits[query.metric],
      range: query.range,
      asOf,
      first: firstPoint,
      latest: latestPoint,
      overall: getDifference(firstPoint, latestPoint),
      changes,
      // Daily points use the latest non-null metric value in each UTC day.
      series: series.map((point) => ({
        id: point.id,
        measuredAt: point.measuredAt,
        value: Number(point.value),
      })),
    };
  }
}
