import { Injectable } from '@nestjs/common';

import { PrismaService } from '#src/infra/database/index';
import type { Prisma } from '#prisma/client';
import {
  trainerAthleteHistoricalSelect,
  trainerAthleteSelect,
} from '../selects/trainer-athlete.select.js';
import type { FindManyTrainerAthletesParams } from '../types/trainer-athlete.types.js';

@Injectable()
export class TrainerAthletesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // FIND MANY
  async findMany({
    where,
    skip,
    take,
    orderBy = [{ createdAt: 'desc' }, { id: 'desc' }],
  }: FindManyTrainerAthletesParams) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.trainerAthlete.findMany({
        where,
        skip,
        take,
        orderBy,
        select: trainerAthleteSelect,
      }),

      this.prisma.trainerAthlete.count({ where }),
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

  // FIND BY ID
  async findById(id: string, where: Prisma.TrainerAthleteWhereInput = {}) {
    return this.prisma.trainerAthlete.findFirst({
      where: {
        AND: [{ id }, where],
      },
      select: trainerAthleteSelect,
    });
  }

  // FIND OPEN RELATIONSHIP
  async findOpenByPair(trainerId: string, athleteId: string) {
    return this.prisma.trainerAthlete.findFirst({
      where: {
        trainerId,
        athleteId,
        status: {
          in: ['PENDING', 'ACTIVE'],
        },
      },
      select: {
        id: true,
        status: true,
      },
    });
  }

  // CREATE
  async create(data: Prisma.TrainerAthleteCreateInput) {
    return this.prisma.trainerAthlete.create({
      data,
      select: trainerAthleteSelect,
    });
  }

  // UPDATE
  async update(
    where: Prisma.TrainerAthleteWhereUniqueInput,
    data: Prisma.TrainerAthleteUpdateInput,
    redactForTrainer = false,
  ) {
    return this.prisma.trainerAthlete.update({
      where,
      data,
      select: redactForTrainer
        ? trainerAthleteHistoricalSelect
        : trainerAthleteSelect,
    });
  }

  // ACTIVE TRAINERS FOR ATHLETE
  async findActiveTrainerIdsForAthlete(athleteId: string): Promise<string[]> {
    const relationships = await this.prisma.trainerAthlete.findMany({
      where: {
        athleteId,
        status: 'ACTIVE',
      },
      select: {
        trainerId: true,
      },
    });

    return relationships.map((item) => item.trainerId);
  }

  // ACTIVE ATHLETES FOR TRAINER
  async findActiveAthleteIdsForTrainer(trainerId: string): Promise<string[]> {
    const relationships = await this.prisma.trainerAthlete.findMany({
      where: {
        trainerId,
        status: 'ACTIVE',
      },
      select: {
        athleteId: true,
      },
    });

    return relationships.map((item) => item.athleteId);
  }

  async findManyForTrainer({
    where,
    skip,
    take,
    orderBy = [{ createdAt: 'desc' }, { id: 'desc' }],
  }: FindManyTrainerAthletesParams) {
    // First load a page without sensitive fields.
    const [historical, total] = await this.prisma.$transaction([
      this.prisma.trainerAthlete.findMany({
        where,
        skip,
        take,
        orderBy,
        select: trainerAthleteHistoricalSelect,
      }),

      this.prisma.trainerAthlete.count({ where }),
    ]);

    // Full details are available only for open relationships.
    const openIds = historical
      .filter((item) => item.status === 'ACTIVE' || item.status === 'PENDING')
      .map((item) => item.id);

    const openRelationships = openIds.length
      ? await this.prisma.trainerAthlete.findMany({
          where: {
            AND: [
              where,
              {
                id: { in: openIds },
                status: { in: ['ACTIVE', 'PENDING'] },
              },
            ],
          },
          select: trainerAthleteSelect,
        })
      : [];

    const openById = new Map(openRelationships.map((item) => [item.id, item]));

    return {
      data: historical.map((item) => openById.get(item.id) ?? item),
      meta: {
        total,
        skip,
        take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  async findHistoricalById(id: string, where: Prisma.TrainerAthleteWhereInput) {
    return this.prisma.trainerAthlete.findFirst({
      where: {
        AND: [
          { id },
          where,
          {
            status: {
              in: ['TERMINATED', 'DECLINED', 'CANCELLED'],
            },
          },
        ],
      },
      select: trainerAthleteHistoricalSelect,
    });
  }
}
