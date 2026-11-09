import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/database/index.js';
import { Prisma } from '../../infra/database/generated/prisma/client.js';
import { metricKeys } from './dto/body-measurement.schemas.js';

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

type MeasurementRecord = Prisma.BodyMeasurementGetPayload<{
  select: typeof bodyMeasurementSelect;
}>;

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

@Injectable()
export class BodyMeasurementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, data: MeasurementChanges) {
    return this.prisma.bodyMeasurement.create({
      data: { ...data, user: { connect: { id: userId } } },
      select: bodyMeasurementSelect,
    });
  }

  async findMany(
    userId: string,
    input: { skip: number; take: number; from?: Date; to?: Date },
  ) {
    const where: Prisma.BodyMeasurementWhereInput = {
      userId,
      ...(input.from || input.to
        ? {
            measuredAt: {
              ...(input.from ? { gte: input.from } : {}),
              ...(input.to ? { lte: input.to } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.bodyMeasurement.findMany({
        where,
        skip: input.skip,
        take: input.take,
        orderBy: [{ measuredAt: 'desc' }, { id: 'desc' }],
        select: bodyMeasurementSelect,
      }),
      this.prisma.bodyMeasurement.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        skip: input.skip,
        take: input.take,
        totalPages: Math.ceil(total / input.take),
      },
    };
  }

  findOne(userId: string, id: string) {
    return this.prisma.bodyMeasurement.findFirst({
      where: { id, userId },
      select: bodyMeasurementSelect,
    });
  }

  /**
   * The per-record row lock prevents concurrent partial updates from
   * accidentally removing the last non-null metric.
   * A DB CHECK constraint independently enforces this invariant.
   */
  update(userId: string, id: string, data: MeasurementChanges) {
    return this.prisma.$transaction(async (tx) => {
      const ids = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "body_measurements"
        WHERE "id" = ${id} AND "user_id" = ${userId}
        FOR UPDATE
      `;
      if (ids.length !== 1) return null;

      const current: MeasurementRecord | null =
        await tx.bodyMeasurement.findUnique({
          where: { id },
          select: bodyMeasurementSelect,
        });
      if (!current) return null;

      const hasMetric = metricKeys.some((key) =>
        data[key] === undefined ? current[key] !== null : data[key] !== null,
      );
      if (!hasMetric) {
        throw new BadRequestException(
          'A measurement must contain at least one body metric',
        );
      }

      return tx.bodyMeasurement.update({
        where: { id, userId },
        data,
        select: bodyMeasurementSelect,
      });
    });
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.bodyMeasurement.deleteMany({
      where: { id, userId },
    });
    return result.count === 1;
  }
}
