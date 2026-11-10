import { Injectable } from '@nestjs/common';

import { PrismaService } from '#src/infra/database/index';
import { Prisma } from '#prisma/client';
import {
  workoutIdempotencySelect,
  workoutSelect,
  workoutSummarySelect,
} from '../selects/workout.select.js';
import type { FindManyWorkoutsParams } from '../types/workout.types.js';

/** Read-only workout queries and pagination, shared by the command repository. */
@Injectable()
export class WorkoutQueriesRepository {
  constructor(protected readonly prisma: PrismaService) {}

  // FIND MANY
  async findMany({
    where = {},
    skip,
    take,
    orderBy = [{ createdAt: 'desc' }, { id: 'desc' }],
  }: FindManyWorkoutsParams) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.workout.findMany({
        where,
        skip,
        take,
        orderBy,
        select: workoutSelect,
      }),

      this.prisma.workout.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        skip,
        take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  /** Opt-in compact page for list screens, without nested exercise/sets. */
  async findManySummary({
    where = {},
    skip,
    take,
    orderBy = [{ createdAt: 'desc' }, { id: 'desc' }],
  }: FindManyWorkoutsParams) {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.workout.findMany({
        where,
        skip,
        take,
        orderBy,
        select: workoutSummarySelect,
      }),
      this.prisma.workout.count({ where }),
    ]);

    return {
      data: rows.map(({ _count, ...workout }) => ({
        ...workout,
        exerciseCount: _count.exercises,
      })),
      meta: {
        total,
        skip,
        take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  // FIND BY ID
  async findById(id: string, where: Prisma.WorkoutWhereInput = {}) {
    return this.prisma.workout.findFirst({
      where: {
        AND: [{ id }, where],
      },
      select: workoutSelect,
    });
  }

  // Find only the stored fingerprint and id; never expose them in HTTP DTOs.
  async findByIdempotencyKey(athleteId: string, key: string) {
    return this.prisma.workout.findUnique({
      where: {
        athleteId_idempotencyKey: { athleteId, idempotencyKey: key },
      },
      select: workoutIdempotencySelect,
    });
  }

}
