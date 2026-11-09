import { describe, expect, it } from 'vitest';

import {
  workoutIdempotencySelect,
  workoutSelect,
  workoutSetSelect,
  workoutSetStatusSelect,
  workoutStartReferenceSelect,
} from '../selects/workout.select.js';

describe('Workouts Prisma projections', () => {
  it('never exposes idempotency secrets in public workouts', () => {
    expect(workoutSelect).not.toHaveProperty('idempotencyKey');
    expect(workoutSelect).not.toHaveProperty('idempotencyFingerprint');
    expect(workoutIdempotencySelect).toEqual({
      id: true,
      idempotencyFingerprint: true,
    });
  });

  it('preserves exercise ordering and nested workout sets', () => {
    expect(workoutSelect.exercises.orderBy).toEqual([
      { sortOrder: 'asc' },
      { id: 'asc' },
    ]);
    expect(workoutSelect.exercises.select.sets.orderBy).toEqual({ setNumber: 'asc' });
    expect(workoutSelect.exercises.select.sets.select).toEqual(workoutSetSelect);
  });

  it('keeps minimal internal projections distinct from public payloads', () => {
    expect(workoutSetStatusSelect).toEqual({ status: true });
    expect(workoutStartReferenceSelect).toEqual({
      id: true,
      programAssignmentId: true,
    });
    expect(workoutSetSelect).toHaveProperty('plannedWeightKg', true);
    expect(workoutSetSelect).toHaveProperty('actualWeightKg', true);
    expect(workoutSetSelect).toHaveProperty('completedAt', true);
  });
});
