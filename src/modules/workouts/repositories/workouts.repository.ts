import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '#src/infra/database/index';
import { Prisma } from '#prisma/client';
import { buildExerciseVisibilityWhere } from '#src/modules/exercises/policies/exercise-access.policy';
import { workoutExerciseReferenceSelect } from '#src/modules/exercises/selects/exercise.select';
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
  /**
   * Serialize manual workout creation with trainer-athlete termination.
   * Both operations use the same relationship row lock. Recheck access after
   * acquiring it, then insert before releasing the lock at commit.
   */
  async create(
    data: Prisma.WorkoutCreateInput,
    athleteId: string,
    exerciseIds: string[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const uniqueIds = [...new Set(exerciseIds)];
      const trainerExercises = await tx.exercise.findMany({
        where: { id: { in: uniqueIds }, source: 'TRAINER_CUSTOM' },
        select: { createdById: true },
      });
      const trainerIds = [...new Set(
        trainerExercises
          .map((exercise) => exercise.createdById)
          .filter((id): id is string => id !== null),
      )];

      // Keep the same lock protocol for new workouts and planned starts.
      const activeRelationships = await this.lockActiveTrainerRelationships(
        tx,
        athleteId,
        trainerIds,
      );

      // Never trust the earlier service-side availability check: it may
      // have run before a concurrent termination. Validate inside this
      // transaction after the relationship locks have been acquired.
      const accessible = await tx.exercise.findMany({
        where: {
          AND: [
            { id: { in: uniqueIds } },
            buildExerciseVisibilityWhere(
              { id: athleteId, role: 'ATHLETE' },
              {
                activeTrainerIds: activeRelationships.map((r) => r.trainerId),
                activeAthleteIds: [],
              },
            ),
            { isArchived: false },
          ],
        },
        select: workoutExerciseReferenceSelect,
      });

      if (accessible.length !== uniqueIds.length) {
        throw new BadRequestException('One or more exercises are not available');
      }

      return tx.workout.create({ data, select: workoutSelect });
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
      // Match the termination lock order: relationship first, assignment
      // second. This also prevents reading ACTIVE after termination begins.
      const activeRelationships = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT relationship."id"
        FROM "trainer_athletes" AS relationship
        INNER JOIN "training_program_assignments" AS assignment
          ON assignment."trainer_athlete_id" = relationship."id"
        WHERE assignment."id" = ${input.assignmentId}
          AND assignment."athlete_id" = ${input.athleteId}
          AND relationship."status" = 'ACTIVE'
        FOR SHARE OF relationship
      `;
      if (activeRelationships.length !== 1) return null;

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

  /** Obtain and retain current ACTIVE collaboration locks until transaction commit. */
  private async lockActiveTrainerRelationships(
    tx: Prisma.TransactionClient,
    athleteId: string,
    trainerIds: string[],
  ): Promise<Array<{ id: string; trainerId: string }>> {
    const ids = [...new Set(trainerIds)];
    if (ids.length === 0) return [];

    // Ordered row locks prevent lock-order inversions when multiple trainers
    // contribute exercises to the same workout.
    return tx.$queryRaw<Array<{ id: string; trainerId: string }>>`
      SELECT "id", "trainer_id" AS "trainerId"
      FROM "trainer_athletes"
      WHERE "athlete_id" = ${athleteId}
        AND "trainer_id" IN (${Prisma.join(ids)})
        AND "status" = 'ACTIVE'
      ORDER BY "id"
      FOR SHARE
    `;
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

      // A planned manual workout can contain trainer exercises that were
      // accessible at creation time but no longer are. Identify the owners
      // before locking any assignment, then serialize against termination.
      const trainerExercises = await tx.exercise.findMany({
        where: {
          source: 'TRAINER_CUSTOM',
          workoutExercises: { some: { workoutId: input.id } },
        },
        select: { createdById: true },
      });

      if (trainerExercises.some((exercise) => !exercise.createdById)) {
        return null;
      }

      const assignmentLink = workout.programAssignmentId
        ? await tx.trainingProgramAssignment.findFirst({
            where: {
              id: workout.programAssignmentId,
              athleteId: input.athleteId,
            },
            select: {
              trainerAthleteId: true,
              trainerAthlete: { select: { trainerId: true } },
            },
          })
        : null;

      if (workout.programAssignmentId && !assignmentLink) return null;

      const requiredTrainerIds = [
        ...new Set([
          ...trainerExercises.map((exercise) => exercise.createdById!),
          ...(assignmentLink ? [assignmentLink.trainerAthlete.trainerId] : []),
        ]),
      ];
      // Uses FOR SHARE, conflicting with termination's UPDATE. If termination
      // won first, rows are no longer ACTIVE and the start is denied; if start
      // won first, termination waits until the start commits.
      const activeRelationships = await this.lockActiveTrainerRelationships(
        tx,
        input.athleteId,
        requiredTrainerIds,
      );
      const activeTrainerIds = new Set(
        activeRelationships.map((relationship) => relationship.trainerId),
      );

      if (requiredTrainerIds.some((id) => !activeTrainerIds.has(id))) {
        return null;
      }
      // A new relationship with the same trainer must not revive an old
      // program assignment after its original relationship ended.
      if (
        assignmentLink &&
        !activeRelationships.some(
          (relationship) => relationship.id === assignmentLink.trainerAthleteId,
        )
      ) {
        return null;
      }

      if (workout.programAssignmentId) {
        // Lock-order discipline: relationship(s) first, assignment second.
        // This serializes with cancellation, completion and termination.
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
