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
  programAssignmentId: true,
  programWorkoutId: true,

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
          targetRpe: true,
          targetRir: true,
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
  targetRpe: true,
  targetRir: true,
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

  async createFromProgram(input: {
    athleteId: string;
    assignmentId: string;
    programWorkoutId: string;
    scheduledAt?: Date | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.trainingProgramAssignment.findFirst({
        where: {
          id: input.assignmentId,
          athleteId: input.athleteId,
          status: 'ACTIVE',
          trainerAthlete: {
            is: {
              status: 'ACTIVE',
            },
          },
          version: {
            is: {
              status: 'PUBLISHED',
            },
          },
        },
        select: {
          id: true,
          version: {
            select: {
              workouts: {
                where: {
                  id: input.programWorkoutId,
                },
                select: {
                  id: true,
                  title: true,
                  notes: true,
                  exercises: {
                    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                    select: {
                      exerciseId: true,
                      exerciseNameSnapshot: true,
                      exerciseTypeSnapshot: true,
                      sortOrder: true,
                      notes: true,
                      sets: {
                        orderBy: { setNumber: 'asc' },
                        select: {
                          setNumber: true,
                          setType: true,
                          plannedReps: true,
                          plannedWeightKg: true,
                          plannedDurationSeconds: true,
                          plannedDistanceMeters: true,
                          restSeconds: true,
                          targetRpe: true,
                          targetRir: true,
                          notes: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const programWorkout = assignment?.version.workouts[0];

      if (!assignment || !programWorkout) {
        return null;
      }

      return tx.workout.create({
        data: {
          title: programWorkout.title,
          notes: programWorkout.notes,
          scheduledAt: input.scheduledAt ?? null,

          athlete: {
            connect: { id: input.athleteId },
          },
          createdBy: {
            connect: { id: input.athleteId },
          },
          programAssignment: {
            connect: { id: assignment.id },
          },
          programWorkout: {
            connect: { id: programWorkout.id },
          },

          exercises: {
            create: programWorkout.exercises.map((exercise) => ({
              exercise: {
                connect: { id: exercise.exerciseId },
              },
              exerciseNameSnapshot: exercise.exerciseNameSnapshot,
              exerciseTypeSnapshot: exercise.exerciseTypeSnapshot,
              sortOrder: exercise.sortOrder,
              notes: exercise.notes,

              sets: {
                create: exercise.sets.map((set) => ({
                  setNumber: set.setNumber,
                  setType: set.setType,
                  plannedReps: set.plannedReps,
                  plannedWeightKg: set.plannedWeightKg,
                  plannedDurationSeconds: set.plannedDurationSeconds,
                  plannedDistanceMeters: set.plannedDistanceMeters,
                  restSeconds: set.restSeconds,
                  targetRpe: set.targetRpe,
                  targetRir: set.targetRir,
                  notes: set.notes,
                })),
              },
            })),
          },
        },
        select: workoutSelect,
      });
    });
  }
}
