import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/database/index.js';
import { Prisma } from '../../infra/database/generated/prisma/client.js';

export const trainerAthleteSelect = {
  id: true,
  trainerId: true,
  athleteId: true,
  initiatedById: true,
  status: true,

  respondedAt: true,
  endedAt: true,
  endedById: true,
  endReason: true,

  trainer: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  athlete: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  initiatedBy: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  endedBy: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrainerAthleteSelect;

export const trainerAthleteHistoricalSelect = {
  id: true,
  trainerId: true,
  athleteId: true,
  initiatedById: true,
  status: true,
  respondedAt: true,
  endedAt: true,
  endedById: true,
  endReason: true,

  trainer: {
    select: {
      id: true,
      role: true,
    },
  },

  athlete: {
    select: {
      id: true,
      role: true,
    },
  },

  initiatedBy: {
    select: {
      id: true,
      role: true,
    },
  },

  endedBy: {
    select: {
      id: true,
      role: true,
    },
  },

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrainerAthleteSelect;

export type FindManyTrainerAthletesParams = {
  where: Prisma.TrainerAthleteWhereInput;
  skip: number;
  take: number;
  orderBy?: Prisma.TrainerAthleteOrderByWithRelationInput[];
};

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
