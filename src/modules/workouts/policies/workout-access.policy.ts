import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { WorkoutActor, WorkoutListQuery } from '../types/workout.types.js';

/** Require the athlete role before accessing personal workout operations. */
export function assertWorkoutAthlete(actor: WorkoutActor): void {
  if (actor.role !== 'ATHLETE') {
    throw new ForbiddenException('Only athletes can manage personal workouts');
  }
}

/** Preserve the existing public pagination limits and error message. */
export function validateWorkoutPagination(query: WorkoutListQuery): void {
  if (
    !Number.isInteger(query.page) ||
    query.page < 1 ||
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 100
  ) {
    throw new BadRequestException('Invalid pagination parameters');
  }
}
