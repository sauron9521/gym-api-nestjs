import { BadRequestException } from '@nestjs/common';

/**
 * A published program must be executable and internally consistent.
 * Call this inside the publication transaction, after locking the draft row.
 */
export function assertPublishableVersion(version: {
  durationWeeks: number | null;
  workouts: ReadonlyArray<{
    weekNumber: number;
    exercises: ReadonlyArray<{ sets: ReadonlyArray<unknown> }>;
  }>;
}): void {
  if (version.workouts.length === 0) {
    throw new BadRequestException(
      'A program must contain at least one workout',
    );
  }

  for (const workout of version.workouts) {
    if (
      version.durationWeeks !== null &&
      workout.weekNumber > version.durationWeeks
    ) {
      throw new BadRequestException(
        'A workout week cannot exceed the program duration',
      );
    }

    if (workout.exercises.length === 0) {
      throw new BadRequestException(
        'Every program workout must contain at least one exercise',
      );
    }

    for (const exercise of workout.exercises) {
      if (exercise.sets.length === 0) {
        throw new BadRequestException(
          'Every program exercise must contain at least one set',
        );
      }
    }
  }
}
