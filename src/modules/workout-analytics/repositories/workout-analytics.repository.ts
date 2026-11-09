import { Injectable } from '@nestjs/common';

import { Prisma } from '#prisma/client';
import { PrismaService } from '#src/infra/database/index';

import type {
  ExerciseAnalyticsDailyRow,
  ExerciseSnapshotRow,
  WorkoutAnalyticsDailyRow,
} from '../types/workout-analytics.types.js';

/**
 * Only real, completed workout/set results are included. All query
 * parameters use Prisma interpolation; SQL identifiers are fixed literals.
 * Every query is filtered by the authenticated athlete ID, never by a
 * client-supplied user ID.
 */
@Injectable()
export class WorkoutAnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async readSummary(athleteId: string, from: Date, asOf: Date) {
    return this.prisma.$queryRaw<WorkoutAnalyticsDailyRow[]>`
      SELECT
        TO_CHAR(w."completed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "date",
        COUNT(DISTINCT w."id")::int AS "workoutCount",
        COUNT(ws."id") FILTER (
          WHERE ws."status" = 'COMPLETED'
        )::int AS "completedSets",
        COALESCE(SUM(
          CASE WHEN ws."status" = 'COMPLETED'
            AND we."exercise_type_snapshot" = 'STRENGTH'
            AND ws."actual_reps" IS NOT NULL
            AND ws."actual_weight_kg" IS NOT NULL
          THEN ws."actual_reps" * ws."actual_weight_kg"
          ELSE 0 END
        ), 0) AS "strengthVolumeKg"
      FROM "workouts" AS w
      LEFT JOIN "workout_exercises" AS we ON we."workout_id" = w."id"
      LEFT JOIN "workout_sets" AS ws ON ws."workout_exercise_id" = we."id"
      WHERE w."athlete_id" = ${athleteId}
        AND w."status" = 'COMPLETED'
        AND w."completed_at" >= ${from}
        AND w."completed_at" <= ${asOf}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
  }

  async readExercise(
    athleteId: string,
    exerciseId: string,
    from: Date,
    asOf: Date,
  ) {
    // Two reads share a stable transaction snapshot. Even if the workout
    // changes concurrently, its latest name and daily aggregates agree.
    return this.prisma.$transaction(
      async (tx) => {
        const [snapshots, days] = await Promise.all([
          tx.$queryRaw<ExerciseSnapshotRow[]>`
            SELECT we."exercise_name_snapshot" AS "name"
            FROM "workouts" AS w
            INNER JOIN "workout_exercises" AS we ON we."workout_id" = w."id"
            WHERE w."athlete_id" = ${athleteId}
              AND w."status" = 'COMPLETED'
              AND w."completed_at" >= ${from}
              AND w."completed_at" <= ${asOf}
              AND we."exercise_id" = ${exerciseId}
            ORDER BY w."completed_at" DESC, w."id" DESC, we."id" DESC
            LIMIT 1
          `,
          tx.$queryRaw<ExerciseAnalyticsDailyRow[]>`
            SELECT
              TO_CHAR(w."completed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "date",
              COUNT(DISTINCT w."id")::int AS "workoutCount",
              COUNT(ws."id") FILTER (
                WHERE ws."status" = 'COMPLETED'
              )::int AS "completedSets",
              COALESCE(SUM(
                CASE WHEN ws."status" = 'COMPLETED'
                  AND we."exercise_type_snapshot" = 'STRENGTH'
                  AND ws."actual_reps" IS NOT NULL
                THEN ws."actual_reps" ELSE 0 END
              ), 0)::int AS "strengthReps",
              COALESCE(SUM(
                CASE WHEN ws."status" = 'COMPLETED'
                  AND we."exercise_type_snapshot" = 'STRENGTH'
                  AND ws."actual_reps" IS NOT NULL
                  AND ws."actual_weight_kg" IS NOT NULL
                THEN ws."actual_reps" * ws."actual_weight_kg"
                ELSE 0 END
              ), 0) AS "strengthVolumeKg",
              MAX(ws."actual_weight_kg") FILTER (
                WHERE ws."status" = 'COMPLETED'
                  AND we."exercise_type_snapshot" = 'STRENGTH'
              ) AS "bestWeightKg"
            FROM "workouts" AS w
            INNER JOIN "workout_exercises" AS we ON we."workout_id" = w."id"
              AND we."exercise_id" = ${exerciseId}
            LEFT JOIN "workout_sets" AS ws ON ws."workout_exercise_id" = we."id"
            WHERE w."athlete_id" = ${athleteId}
              AND w."status" = 'COMPLETED'
              AND w."completed_at" >= ${from}
              AND w."completed_at" <= ${asOf}
            GROUP BY 1
            ORDER BY 1 ASC
          `,
        ]);
        return { name: snapshots[0]?.name ?? null, days };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
