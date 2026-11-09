import { Injectable } from '@nestjs/common';

import { PrismaService } from '#src/infra/database/index';
import { Prisma } from '#prisma/client';
import type { BodyMeasurementMetric } from './dto/body-measurement-statistics.schemas.js';

const metricColumns: Record<BodyMeasurementMetric, string> = {
  weightKg: 'weight_kg',
  bodyFatPct: 'body_fat_pct',
  chestCm: 'chest_cm',
  waistCm: 'waist_cm',
  hipsCm: 'hips_cm',
  armCm: 'arm_cm',
  thighCm: 'thigh_cm',
};

/** Small fixed projection for metric endpoints: never load notes or users. */
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

export type MeasurementStatisticsRecord = Prisma.BodyMeasurementGetPayload<{
  select: typeof measurementStatisticsSelect;
}>;

export type DailyMetricRecord = {
  id: string;
  measuredAt: Date;
  value: Prisma.Decimal;
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
    const from = new Date(asOf.getTime() - seriesDays * 86_400_000);

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
    const read = (
      orderBy: Prisma.BodyMeasurementOrderByWithRelationInput[],
      before?: Date,
    ) =>
      this.prisma.bodyMeasurement.findFirst({
        where: {
          ...where,
          ...(before ? { measuredAt: { lte: before } } : {}),
        },
        orderBy,
        select: measurementStatisticsSelect,
      });

    // Column identifiers come solely from our static allowlist.
    // Prisma.raw must NEVER be given a user-supplied identifier.
    const metricColumn = Prisma.raw(`"${metricColumns[metric]}"`);

    const [first, latest, baseline7, baseline30, baseline90, series] =
      await Promise.all([
        read(earliest),
        read(newest),
        read(newest, cutoffs[0]),
        read(newest, cutoffs[1]),
        read(newest, cutoffs[2]),
        this.prisma.$queryRaw<DailyMetricRecord[]>`
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
  }
}
