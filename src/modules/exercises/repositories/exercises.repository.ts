import { Injectable } from '@nestjs/common';
import type { Prisma } from '#prisma/client';
import { PrismaService } from '#src/infra/database/index';

import {
  archivedExerciseSelect,
  exerciseSelect,
  workoutExerciseReferenceSelect,
} from '../selects/exercise.select.js';
import type { FindManyExercisesParams } from '../types/exercise.types.js';

@Injectable()
export class ExercisesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany({
    where = {},
    skip,
    take,
    orderBy = [{ name: 'asc' }, { id: 'asc' }],
  }: FindManyExercisesParams) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.exercise.findMany({
        where,
        skip,
        take,
        orderBy,
        select: exerciseSelect,
      }),
      this.prisma.exercise.count({ where }),
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

  async findById(id: string, where: Prisma.ExerciseWhereInput) {
    return this.prisma.exercise.findFirst({
      where: { AND: [{ id }, where] },
      select: exerciseSelect,
    });
  }

  async findBySlug(slug: string, where: Prisma.ExerciseWhereInput = {}) {
    return this.prisma.exercise.findFirst({
      where: { AND: [{ slug }, where] },
      select: exerciseSelect,
    });
  }

  async create(data: Prisma.ExerciseCreateInput) {
    return this.prisma.exercise.create({
      data,
      select: exerciseSelect,
    });
  }

  async update(
    where: Prisma.ExerciseWhereUniqueInput,
    data: Prisma.ExerciseUpdateInput,
  ) {
    return this.prisma.exercise.update({
      where,
      data,
      select: exerciseSelect,
    });
  }

  async archive(where: Prisma.ExerciseWhereUniqueInput) {
    return this.prisma.exercise.update({
      where,
      data: {
        isArchived: true,
      },
      select: archivedExerciseSelect,
    });
  }

  async findMuscleGroupsBySlugs(slugs: string[]) {
    return this.prisma.muscleGroup.findMany({
      where: {
        slug: { in: slugs },
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });
  }

  async findEquipmentBySlugs(slugs: string[]) {
    return this.prisma.equipment.findMany({
      where: {
        slug: { in: slugs },
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });
  }

  async findAvailableForWorkout(
    ids: string[],
    where: Prisma.ExerciseWhereInput,
  ) {
    return this.prisma.exercise.findMany({
      where: {
        AND: [{ id: { in: ids } }, where],
      },
      select: workoutExerciseReferenceSelect,
    });
  }
}
