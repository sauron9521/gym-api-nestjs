import { Injectable } from '@nestjs/common';

import { PrismaService } from '#src/infra/database/index';
import {
  workoutSelect,
  workoutSetStatusSelect,
  workoutStartReferenceSelect,
} from '../selects/workout.select.js';
import { lockActiveTrainerRelationships } from './workout-locks.js';

/** Lifecycle transitions retain transaction and relationship lock boundaries. */
@Injectable()
export class WorkoutLifecycleRepository {
  constructor(private readonly prisma: PrismaService) {}

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
      const activeRelationships = await lockActiveTrainerRelationships(
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
