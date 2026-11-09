import { Injectable } from '@nestjs/common';

import {
  statisticsRangeDays,
  statisticsUnits,
  type BodyMeasurementStatisticsQueryDto,
} from '../dto/body-measurement-statistics.schemas.js';
import {
  getMetricDifference,
  mapMetricPoint,
} from '../mappers/body-measurement-statistics.mapper.js';
import { BodyMeasurementStatisticsRepository } from '../repositories/body-measurement-statistics.repository.js';

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
    const firstPoint = mapMetricPoint(first, query.metric);
    const latestPoint = mapMetricPoint(latest, query.metric);

    const changes = Object.fromEntries(
      (['7d', '30d', '90d'] as const).map((range) => {
        const baseline = mapMetricPoint(baselines[range], query.metric);
        const cutoff = asOf.getTime() -
          statisticsRangeDays[range] * 86_400_000;
        const recent = latestPoint &&
          latestPoint.measuredAt.getTime() >= cutoff
          ? latestPoint : null;
        return [
          range,
          {
            baseline,
            ...getMetricDifference(baseline, recent),
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
      overall: getMetricDifference(firstPoint, latestPoint),
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
