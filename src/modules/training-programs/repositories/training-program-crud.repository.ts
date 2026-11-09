import { Injectable } from '@nestjs/common';
import { PrismaService } from '#src/infra/database/index';
import { Prisma } from '#prisma/client';

import { trainingProgramSelect } from '../selects/training-program.select.js';

import type { TrainingProgramPayload } from '../types/training-program-payload.types.js';

import type { PaginatedResult } from '../types/paginated-result.types.js';
import type { FindManyTrainingProgramsParams } from '../types/training-program-repository.types.js';

@Injectable()
export class TrainingProgramCrudRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany({
    where,
    skip,
    take,
    orderBy = [{ updatedAt: 'desc' }, { id: 'desc' }],
  }: FindManyTrainingProgramsParams): Promise<
    PaginatedResult<TrainingProgramPayload>
  > {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.trainingProgram.findMany({
        where,
        skip,
        take,
        orderBy,
        select: trainingProgramSelect,
      }),

      this.prisma.trainingProgram.count({ where }),
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

  async findProgramById(
    id: string,
    where: Prisma.TrainingProgramWhereInput = {},
  ): Promise<TrainingProgramPayload | null> {
    return this.prisma.trainingProgram.findFirst({
      where: {
        AND: [{ id }, where],
      },
      select: trainingProgramSelect,
    });
  }

  async createProgram(data: Prisma.TrainingProgramCreateInput) {
    return this.prisma.trainingProgram.create({
      data,
      select: trainingProgramSelect,
    });
  }

  async updateProgram(
    where: Prisma.TrainingProgramWhereUniqueInput,
    data: Prisma.TrainingProgramUpdateInput,
  ) {
    return this.prisma.trainingProgram.update({
      where,
      data,
      select: trainingProgramSelect,
    });
  }
  async createProgramWithDraft(input: {
    trainerId: string;
    title: string;
    description?: string | null;
    durationWeeks?: number | null;
  }) {
    return this.prisma.trainingProgram.create({
      data: {
        trainer: {
          connect: { id: input.trainerId },
        },
        versions: {
          create: {
            version: 1,
            title: input.title,
            description: input.description ?? null,
            durationWeeks: input.durationWeeks ?? null,
            status: 'DRAFT',
          },
        },
      },
      select: trainingProgramSelect,
    });
  }
}
