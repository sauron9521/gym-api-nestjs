import { Injectable } from '@nestjs/common';

import { assertWorkoutAthlete } from '#src/modules/workouts/policies/workout-access.policy';
import type { WorkoutActor } from '#src/modules/workouts/types/workout.types';

import {
  workoutAnalyticsRangeDays,
  type WorkoutAnalyticsQuery,
} from '../dto/workout-analytics.schemas.js';
import { WorkoutAnalyticsRepository } from '../repositories/workout-analytics.repository.js';
import { workoutAnalyticsWindow } from '../utils/workout-analytics-window.js';

const asNumber = (value: unknown): number => Number(value);
const round2 = (value: number): number => Number(value.toFixed(2));

@Injectable()
export class WorkoutAnalyticsService {
  constructor(private readonly repository: WorkoutAnalyticsRepository) {}

  async summary(actor: WorkoutActor, query: WorkoutAnalyticsQuery) {
    assertWorkoutAthlete(actor);
    const asOf = new Date();
    const from = workoutAnalyticsWindow(
      asOf, workoutAnalyticsRangeDays[query.range],
    );
    const rows = await this.repository.readSummary(actor.id, from, asOf);
    const daily = rows.map((row) => ({
      date: row.date,
      workoutCount: row.workoutCount,
      completedSets: row.completedSets,
      strengthVolumeKg: asNumber(row.strengthVolumeKg),
    }));

    return {
      range: query.range,
      from,
      asOf,
      workoutCount: daily.reduce((sum, item) => sum + item.workoutCount, 0),
      activeDays: daily.length,
      completedSets: daily.reduce((sum, item) => sum + item.completedSets, 0),
      strengthVolumeKg: round2(daily.reduce(
        (sum, item) => sum + item.strengthVolumeKg, 0,
      )),
      daily,
    };
  }

  async exercise(
    actor: WorkoutActor,
    exerciseId: string,
    query: WorkoutAnalyticsQuery,
  ) {
    assertWorkoutAthlete(actor);
    const asOf = new Date();
    const from = workoutAnalyticsWindow(
      asOf, workoutAnalyticsRangeDays[query.range],
    );
    const result = await this.repository.readExercise(
      actor.id, exerciseId, from, asOf,
    );
    const daily = result.days.map((row) => ({
      date: row.date,
      workoutCount: row.workoutCount,
      completedSets: row.completedSets,
      strengthReps: row.strengthReps,
      strengthVolumeKg: asNumber(row.strengthVolumeKg),
      bestWeightKg: row.bestWeightKg === null
        ? null : asNumber(row.bestWeightKg),
    }));
    const weights = daily
      .map((row) => row.bestWeightKg)
      .filter((weight): weight is number => weight !== null);

    return {
      range: query.range,
      from,
      asOf,
      exerciseId,
      // The name is historical, not a read of the current exercise library.
      // An unknown or inaccessible ID returns an empty history, not a hint.
      name: result.name,
      workoutCount: daily.reduce((sum, row) => sum + row.workoutCount, 0),
      completedSets: daily.reduce((sum, row) => sum + row.completedSets, 0),
      strengthReps: daily.reduce((sum, row) => sum + row.strengthReps, 0),
      strengthVolumeKg: round2(daily.reduce(
        (sum, row) => sum + row.strengthVolumeKg, 0,
      )),
      bestWeightKg: weights.length > 0 ? Math.max(...weights) : null,
      daily,
    };
  }
}
