import { describe, expect, it } from 'vitest';

import { createWorkoutSchema } from '../dto/create-workout.dto.js';
import { updateWorkoutSetSchema } from '../dto/update-workout-set.dto.js';

const exerciseId = '11111111-1111-4111-8111-111111111111';

function createWithSet(set: Record<string, number | null>) {
  return createWorkoutSchema.safeParse({
    title: 'Strength session',
    exercises: [{ exerciseId, sets: [set] }],
  });
}

describe('Workout decimal input matches Prisma Decimal scale', () => {
  it.each([
    ['plannedWeightKg', 72.34, 72.345],
    ['plannedDistanceMeters', 123.45, 123.456],
    ['targetRpe', 8.5, 8.55],
  ] as const)('validates %s in manual workout creation', (field, valid, invalid) => {
    expect(createWithSet({ [field]: valid }).success).toBe(true);
    expect(createWithSet({ [field]: invalid }).success).toBe(false);
  });

  it.each([
    ['plannedWeightKg', 999999.99],
    ['plannedDistanceMeters', 99999999.99],
    ['targetRpe', 10],
  ] as const)('accepts the database maximum for %s', (field, maximum) => {
    expect(createWithSet({ [field]: maximum }).success).toBe(true);
  });

  it.each([
    ['actualWeightKg', 72.34, 72.345],
    ['actualDistanceMeters', 123.45, 123.456],
    ['rpe', 8.5, 8.55],
  ] as const)('validates %s when completing a set', (field, valid, invalid) => {
    expect(updateWorkoutSetSchema.safeParse({ status: 'COMPLETED', [field]: valid }).success).toBe(true);
    expect(updateWorkoutSetSchema.safeParse({ status: 'COMPLETED', [field]: invalid }).success).toBe(false);
  });

  it('preserves zero values, null, and omitted optional fields', () => {
    expect(createWithSet({ plannedWeightKg: 0, plannedDistanceMeters: 0 }).success).toBe(true);
    expect(createWithSet({ plannedWeightKg: null, plannedDistanceMeters: null, targetRpe: null }).success).toBe(true);
    expect(createWithSet({}).success).toBe(true);
    expect(updateWorkoutSetSchema.safeParse({
      status: 'COMPLETED',
      actualWeightKg: null,
      actualDistanceMeters: null,
      rpe: null,
    }).success).toBe(true);
  });

  it('rejects values outside the Prisma decimal ranges', () => {
    expect(createWithSet({ plannedWeightKg: 1000000 }).success).toBe(false);
    expect(createWithSet({ plannedDistanceMeters: 100000000 }).success).toBe(false);
    expect(createWithSet({ targetRpe: 10.1 }).success).toBe(false);
  });
});
