import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  assertWorkoutAthlete,
  validateWorkoutPagination,
} from '../policies/workout-access.policy.js';

describe('workout access and pagination policies', () => {
  it('limits personal workout management to ATHLETE role', () => {
    expect(() => assertWorkoutAthlete({ id: 'athlete-1', role: 'ATHLETE' }))
      .not.toThrow();
    expect(() => assertWorkoutAthlete({ id: 'trainer-1', role: 'TRAINER' }))
      .toThrow(ForbiddenException);
    expect(() => assertWorkoutAthlete({ id: 'admin-1', role: 'ADMIN' }))
      .toThrow('Only athletes can manage personal workouts');
  });

  it('validates pagination within the existing inclusive range', () => {
    expect(() => validateWorkoutPagination({ page: 1, limit: 1 })).not.toThrow();
    expect(() => validateWorkoutPagination({ page: 5, limit: 100 })).not.toThrow();
    for (const query of [
      { page: 0, limit: 20 },
      { page: 1, limit: 101 },
      { page: 0.25, limit: 20 },
      { page: 1, limit: 5.5 },
    ]) {
      expect(() => validateWorkoutPagination(query)).toThrow(BadRequestException);
    }
  });
});
