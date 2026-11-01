import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/index.js';
import { Prisma } from '../../generated/prisma/client.js';

export const workoutSelect = {
  id: true,
  title: true,
  notes: true,
  athleteId: true,
  createdById: true,
  status: true,
  scheduledAt: true,
  startedAt: true,
  completedAt: true,

  exercises: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      workoutId: true,
      exerciseId: true,
      exerciseNameSnapshot: true,
      exerciseTypeSnapshot: true,
      sortOrder: true,
      notes: true,
      createdAt: true,
      updatedAt: true,

      sets: {
        orderBy: { setNumber: 'asc' },
        select: {
          id: true,
          workoutExerciseId: true,
          setNumber: true,
          setType: true,
          status: true,

          plannedReps: true,
          plannedWeightKg: true,
          plannedDurationSeconds: true,
          plannedDistanceMeters: true,

          actualReps: true,
          actualWeightKg: true,
          actualDurationSeconds: true,
          actualDistanceMeters: true,

          restSeconds: true,
          rpe: true,
          rir: true,

          completedAt: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  },

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkoutSelect;

export const workoutSetSelect = {
  id: true,
  workoutExerciseId: true,
  setNumber: true,
  setType: true,
  status: true,

  plannedReps: true,
  plannedWeightKg: true,
  plannedDurationSeconds: true,
  plannedDistanceMeters: true,

  actualReps: true,
  actualWeightKg: true,
  actualDurationSeconds: true,
  actualDistanceMeters: true,

  restSeconds: true,
  rpe: true,
  rir: true,

  completedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkoutSetSelect;

export type FindManyWorkoutsParams = {
  where?: Prisma.WorkoutWhereInput;
  skip: number;
  take: number;
  orderBy?: Prisma.WorkoutOrderByWithRelationInput[];
};

@Injectable()
export class WorkoutsRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  // FIND BY ID
  async findById(id: string, where: Prisma.WorkoutWhereInput = {}) {
    return this.prisma.workout.findFirst({
      where: {
        AND: [{ id }, where],
      },
      select: workoutSelect,
    });
  }

  // CREATE
  async create(data: Prisma.WorkoutCreateInput) {
    return this.prisma.workout.create({
      data,
      select: workoutSelect,
    });
  }

  // UPDATE
  async update(
    where: Prisma.WorkoutWhereUniqueInput,
    data: Prisma.WorkoutUpdateInput,
  ) {
    return this.prisma.workout.update({
      where,
      data,
      select: workoutSelect,
    });
  }

  async updateSet(id: string, data: Prisma.WorkoutSetUpdateInput) {
    return this.prisma.workoutSet.update({
      where: { id },
      data,
      select: workoutSetSelect,
    });
  }
}
