import { describe, expect, it } from 'vitest';

import {
  archivedExerciseSelect,
  exerciseSelect,
  workoutExerciseReferenceSelect,
} from '../selects/exercise.select.js';

describe('Exercise Prisma select projections', () => {
  it('keeps the public nested muscle groups and equipment, but never loads access grants', () => {
    expect(exerciseSelect).not.toHaveProperty('trainerAccesses');
    expect(exerciseSelect).not.toHaveProperty('assignments');
    expect(exerciseSelect.muscleGroups.select.muscleGroup.select)
      .toEqual({ id: true, name: true, slug: true });
    expect(exerciseSelect.equipment.select.equipment.select)
      .toEqual({ id: true, name: true, slug: true });
  });

  it('archives without returning unrelated exercise fields', () => {
    expect(archivedExerciseSelect).toEqual({
      id: true,
      isArchived: true,
      updatedAt: true,
    });
  });

  it('uses only the workout snapshot fields', () => {
    expect(workoutExerciseReferenceSelect).toEqual({
      id: true,
      name: true,
      exerciseType: true,
    });
  });
});
