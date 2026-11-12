import { describe, expect, it } from 'vitest';

import { createTrainingProgramSetSchema } from '../dto/create-training-program-set.dto.js';
import { updateTrainingProgramSetSchema } from '../dto/update-training-program-set.dto.js';

describe('Training program set input matches Prisma Decimal scale', () => {
  it.each([
    ['plannedWeightKg', 72.34, 72.345, 999999.99],
    ['plannedDistanceMeters', 123.45, 123.456, 99999999.99],
    ['targetRpe', 8.5, 8.55, 10],
  ] as const)('validates %s for create and update', (field, valid, invalid, maximum) => {
    for (const schema of [createTrainingProgramSetSchema, updateTrainingProgramSetSchema]) {
      expect(schema.safeParse({ [field]: valid }).success).toBe(true);
      expect(schema.safeParse({ [field]: invalid }).success).toBe(false);
      expect(schema.safeParse({ [field]: maximum }).success).toBe(true);
    }
  });

  it('preserves nullable and optional inputs for partial updates', () => {
    expect(createTrainingProgramSetSchema.safeParse({
      plannedWeightKg: 0,
      plannedDistanceMeters: 0,
      targetRpe: null,
    }).success).toBe(true);
    expect(updateTrainingProgramSetSchema.safeParse({
      plannedWeightKg: null,
      plannedDistanceMeters: null,
      targetRpe: null,
    }).success).toBe(true);
    expect(createTrainingProgramSetSchema.safeParse({}).success).toBe(true);
    expect(updateTrainingProgramSetSchema.safeParse({}).success).toBe(false);
  });

  it('rejects values above database bounds in both flows', () => {
    for (const schema of [createTrainingProgramSetSchema, updateTrainingProgramSetSchema]) {
      expect(schema.safeParse({ plannedWeightKg: 1000000 }).success).toBe(false);
      expect(schema.safeParse({ plannedDistanceMeters: 100000000 }).success).toBe(false);
      expect(schema.safeParse({ targetRpe: 10.1 }).success).toBe(false);
    }
  });
});
