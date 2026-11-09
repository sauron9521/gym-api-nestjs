import { Injectable } from '@nestjs/common';

import { PrismaService } from '#src/infra/database/index';
import { Prisma } from '#prisma/client';
import {
  workoutIdempotencySelect,
  workoutSelect,
  workoutSetSelect,
  workoutSetStatusSelect,
  workoutStartReferenceSelect,
} from '../selects/workout.select.js';
import type { FindManyWorkoutsParams } from '../types/workout.types.js';

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

  // Find only the stored fingerprint and id; never expose them in HTTP DTOs.
  async findByIdempotencyKey(athleteId: string, key: string) {
    return this.prisma.workout.findUnique({
      where: {
        athleteId_idempotencyKey: { athleteId, idempotencyKey: key },
      },
      select: workoutIdempotencySelect,
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
    return this.prisma.$transaction(async (tx) => {
      // Lock the parent workout row before modifying its set.
      const workouts = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`
      SELECT
        w."id",
        w."status"
      FROM "workouts" AS w
      INNER JOIN "workout_exercises" AS we
        ON we."workout_id" = w."id"
      INNER JOIN "workout_sets" AS ws
        ON ws."workout_exercise_id" = we."id"
      WHERE ws."id" = ${id}
      FOR UPDATE OF w
    `;

      if (workouts.length !== 1 || workouts[0].status !== 'IN_PROGRESS') {
        return null;
      }

      // This update executes while holding the workout lock.
      return tx.workoutSet.update({
        where: { id },
        data,
        select: workoutSetSelect,
      });
    });
  }

  async completeWorkout(input: {
    id: string;
    athleteId: string;
    completedAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      // Use the same parent-row lock as updateSet().
      const workouts = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >`
      SELECT "id", "status"
      FROM "workouts"
      WHERE "id" = ${input.id}
        AND "athlete_id" = ${input.athleteId}
      FOR UPDATE
    `;

      if (workouts.length !== 1 || workouts[0].status !== 'IN_PROGRESS') {
        return { status: 'NOT_IN_PROGRESS' as const };
      }

      // Re-read actual set statuses AFTER acquiring the lock.
      const sets = await tx.workoutSet.findMany({
        where: {
          workoutExercise: {
            is: {
              workoutId: input.id,
            },
          },
        },
        select: workoutSetStatusSelect,
      });

      const hasPendingSets = sets.some((set) => set.status === 'PENDING');

      const hasCompletedSet = sets.some((set) => set.status === 'COMPLETED');

      if (sets.length === 0 || hasPendingSets || !hasCompletedSet) {
        return { status: 'INVALID_SETS' as const };
      }

      const workout = await tx.workout.update({
        where: {
          id: input.id,
          athleteId: input.athleteId,
          status: 'IN_PROGRESS',
        },
        data: {
          status: 'COMPLETED',
          completedAt: input.completedAt,
        },
        select: workoutSelect,
      });

      return {
        status: 'COMPLETED' as const,
        workout,
      };
    });
  }

  async createFromProgram(input: {
    athleteId: string;
    assignmentId: string;
    programWorkoutId: string;
    scheduledAt?: Date | null;
    idempotency?: { key: string; fingerprint: string };
  }) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize workout creation with assignment completion.
      const assignments = await tx.$queryRaw<Array<{ id: string }>>`
  SELECT "id"
  FROM "training_program_assignments"
  WHERE
    "id" = ${input.assignmentId}
    AND "athlete_id" = ${input.athleteId}
    AND "status" = 'ACTIVE'
  FOR UPDATE
`;

      if (assignments.length !== 1) {
        return null;
      }
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
          ...(input.idempotency
            ? {
                idempotencyKey: input.idempotency.key,
                idempotencyFingerprint: input.idempotency.fingerprint,
              }
            : {}),

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

  async startWorkout(input: {
    id: string;
    athleteId: string;
    startedAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const workout = await tx.workout.findFirst({
        where: {
          id: input.id,
          athleteId: input.athleteId,
          status: 'PLANNED',
        },
        select: workoutStartReferenceSelect,
      });

      if (!workout) {
        return null;
      }

      if (workout.programAssignmentId) {
        // Lock the assignment row to serialize workout start
        // with cancellation, completion and termination.
        const assignments = await tx.$queryRaw<
          Array<{
            id: string;
            status: string;
            startedAt: Date | null;
          }>
        >`
        SELECT
          "id",
          "status",
          "started_at" AS "startedAt"
        FROM "training_program_assignments"
        WHERE
          "id" = ${workout.programAssignmentId}
          AND "athlete_id" = ${input.athleteId}
        FOR UPDATE
      `;

        const assignment = assignments[0];

        // A workout from an inactive assignment cannot be started.
        if (!assignment || assignment.status !== 'ACTIVE') {
          return null;
        }

        // Preserve the timestamp of the first workout start.
        if (!assignment.startedAt) {
          await tx.trainingProgramAssignment.update({
            where: {
              id: assignment.id,
            },
            data: {
              startedAt: input.startedAt,
            },
          });
        }
      }

      return tx.workout.update({
        where: {
          id: input.id,
          athleteId: input.athleteId,
          status: 'PLANNED',
        },
        data: {
          status: 'IN_PROGRESS',
          startedAt: input.startedAt,
        },
        select: workoutSelect,
      });
    });
  }
}
