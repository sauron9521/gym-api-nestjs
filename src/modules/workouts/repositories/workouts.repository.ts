import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '#src/infra/database/index';
import { Prisma } from '#prisma/client';
import { buildExerciseVisibilityWhere } from '#src/modules/exercises/policies/exercise-access.policy';
import { workoutExerciseReferenceSelect } from '#src/modules/exercises/selects/exercise.select';
import {
  workoutSelect,
  workoutSetSelect,
  workoutSetStatusSelect,
  workoutStartReferenceSelect,
} from '../selects/workout.select.js';
import { WorkoutQueriesRepository } from './workout-queries.repository.js';

@Injectable()
export class WorkoutsRepository extends WorkoutQueriesRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
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

      // Lock exercise rows BEFORE relationship rows (the same order as
      // startWorkout). Archiving updates these rows and cannot commit between
      // this authorization check and the final workout insert.
      const lockedExercises = await this.lockExerciseReferences(tx, uniqueIds);
      if (
        lockedExercises.length !== uniqueIds.length ||
        lockedExercises.some((exercise) => exercise.isArchived)
      ) {
        throw new BadRequestException('One or more exercises are not available');
      }

      const trainerIds = [...new Set(
        lockedExercises
          .filter((exercise) => exercise.source === 'TRAINER_CUSTOM')
          .map((exercise) => exercise.createdById)
          .filter((id): id is string => id !== null),
      )];

      // Serialize with relationship termination using the same lock order as
      // planned workout starts: exercise -> relationship -> assignment.
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
      // The published workout is immutable to ordinary clients, but load its
      // exercise references before taking locks so the lock order matches
      // manual creation and planned starts: exercises -> relationship -> assignment.
      const reference = await tx.trainingProgramAssignment.findFirst({
        where: {
          id: input.assignmentId,
          athleteId: input.athleteId,
          status: 'ACTIVE',
          version: { is: { status: 'PUBLISHED' } },
        },
        select: {
          version: {
            select: {
              workouts: {
                where: { id: input.programWorkoutId },
                select: { exercises: { select: { exerciseId: true } } },
              },
            },
          },
        },
      });

      const candidateWorkout = reference?.version.workouts[0];
      if (!candidateWorkout) return null;

      const referenceIds = [
        ...new Set(candidateWorkout.exercises.map((exercise) => exercise.exerciseId)),
      ];
      const lockedExercises = await this.lockExerciseReferences(tx, referenceIds);
      if (
        lockedExercises.length !== referenceIds.length ||
        lockedExercises.some((exercise) => exercise.isArchived)
      ) return null;

      // Check the current relationship AFTER securing the exercise rows,
      // before locking the assignment. Termination must wait at this boundary.
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

      // Defensive consistency check: a concurrent change to the program
      // workout cannot introduce an exercise absent from our locked set.
      const currentIds = [
        ...new Set(programWorkout.exercises.map((exercise) => exercise.exerciseId)),
      ];
      if (
        currentIds.length !== referenceIds.length ||
        currentIds.some((id) => !referenceIds.includes(id))
      ) return null;

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

  /**
   * Lock all referenced source exercise rows, not just trainer-owned ones.
   * FOR SHARE conflicts with the UPDATE used by ExercisesRepository.archive().
   * The transaction retains these locks until it commits the nested workout.
   */
  private async lockExerciseReferences(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<
    Array<{
      id: string;
      source: string;
      createdById: string | null;
      isArchived: boolean;
    }>
  > {
    if (ids.length === 0) return [];

    return tx.$queryRaw<
      Array<{
        id: string;
        source: string;
        createdById: string | null;
        isArchived: boolean;
      }>
    >`
      SELECT
        "id",
        "source",
        "created_by_id" AS "createdById",
        "is_archived" AS "isArchived"
      FROM "exercises"
      WHERE "id" IN (${Prisma.join(ids)})
      ORDER BY "id"
      FOR SHARE
    `;
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

      // Exercise archival is an UPDATE of the exercise row. FOR SHARE
      // conflicts with that UPDATE, so a concurrent archive either commits
      // before this read (and is observed) or waits for this start to commit.
      // Lock all referenced exercises, not just trainer-owned ones: global
      // and athlete-owned exercises can be archived too.
      const referencedExercises = await tx.$queryRaw<
        Array<{
          id: string;
          source: string;
          createdById: string | null;
          isArchived: boolean;
        }>
      >`
        SELECT
          e."id",
          e."source",
          e."created_by_id" AS "createdById",
          e."is_archived" AS "isArchived"
        FROM "exercises" AS e
        INNER JOIN "workout_exercises" AS we
          ON we."exercise_id" = e."id"
        WHERE we."workout_id" = ${input.id}
        ORDER BY e."id"
        FOR SHARE OF e
      `;

      // Keep historical workout and exercise snapshots, but do not start an
      // old PLANNED workout with any archived source exercise.
      if (referencedExercises.some((exercise) => exercise.isArchived)) {
        return null;
      }

      const trainerExercises = referencedExercises.filter(
        (exercise) => exercise.source === 'TRAINER_CUSTOM',
      );
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
