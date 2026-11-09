import { Injectable } from '@nestjs/common';

import { PrismaService } from '#src/infra/database/index';
import { Prisma } from '#prisma/client';
import type { BodyMeasurementMetric } from '../dto/body-measurement-statistics.schemas.js';
import { measurementStatisticsSelect } from '../selects/body-measurement.select.js';
import type { DailyMetricRecord } from '../types/body-measurement.types.js';
import { utcSeriesStart } from '../utils/statistics-utc-period.js';

const metricColumns: Record<BodyMeasurementMetric, string> = {
  weightKg: 'weight_kg',
  bodyFatPct: 'body_fat_pct',
  chestCm: 'chest_cm',
  waistCm: 'waist_cm',
  hipsCm: 'hips_cm',
  armCm: 'arm_cm',
  thighCm: 'thigh_cm',
};

@Injectable()
export class BodyMeasurementStatisticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async readStatistics(
    userId: string,
    metric: BodyMeasurementMetric,
    asOf: Date,
    seriesDays: number,
  ) {
    const cutoffs = [7, 30, 90].map(
      (days) => new Date(asOf.getTime() - days * 86_400_000),
    );
    // Chart ranges are UTC calendar days including the current UTC day,
    // unlike rolling hour windows used by 7/30/90-day comparisons.
    const from = utcSeriesStart(asOf, seriesDays);

    const where: Prisma.BodyMeasurementWhereInput = {
      userId,
      measuredAt: { lte: asOf },
      [metric]: { not: null },
    };
    const earliest = [
      { measuredAt: 'asc' as const },
      { id: 'asc' as const },
    ];
    const newest = [
      { measuredAt: 'desc' as const },
      { id: 'desc' as const },
    ];
    // All first/latest/baseline/chart reads must see one PostgreSQL
    // snapshot. Without REPEATABLE READ, concurrent measurement writes can
    // make 'latest' disagree with the series and period deltas.
    return this.prisma.$transaction(
      async (tx) => {
        const read = (
          orderBy: Prisma.BodyMeasurementOrderByWithRelationInput[],
          before?: Date,
        ) =>
          tx.bodyMeasurement.findFirst({
            where: {
              ...where,
              ...(before ? { measuredAt: { lte: before } } : {}),
            },
            orderBy,
            select: measurementStatisticsSelect,
          });

        // Identifiers come solely from our static metric allowlist. Never
        // use Prisma.raw with arbitrary strings supplied by clients.
        const metricColumn = Prisma.raw(`"${metricColumns[metric]}"`);

        const [first, latest, baseline7, baseline30, baseline90, series] =
          await Promise.all([
            read(earliest),
            read(newest),
            read(newest, cutoffs[0]),
            read(newest, cutoffs[1]),
            read(newest, cutoffs[2]),
            tx.$queryRaw<DailyMetricRecord[]>`
              SELECT DISTINCT ON (DATE("measured_at" AT TIME ZONE 'UTC'))
                "id",
                "measured_at" AS "measuredAt",
                ${metricColumn} AS "value"
              FROM "body_measurements"
              WHERE "user_id" = ${userId}
                AND "measured_at" >= ${from}
                AND "measured_at" <= ${asOf}
                AND ${metricColumn} IS NOT NULL
              ORDER BY DATE("measured_at" AT TIME ZONE 'UTC') ASC,
                "measured_at" DESC, "id" DESC
            `,
          ]);

        return {
          first,
          latest,
          baselines: {
            '7d': baseline7,
            '30d': baseline30,
            '90d': baseline90,
          },
          series,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
