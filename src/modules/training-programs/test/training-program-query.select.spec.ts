import { describe, expect, it } from 'vitest';

import {
  trainingProgramExerciseOrderSelect,
  trainingProgramSetOrderSelect,
  trainingProgramVersionListSelect,
} from '../selects/training-program-query.select.js';
import { trainingProgramDraftAccessSelect } from '../selects/training-program-access.select.js';
import { trainingProgramAssignmentHistoricalSelect } from '../selects/training-program-assignment.select.js';

describe('Training Programs minimal Prisma projections', () => {
  it('keeps the version-list response limited to public metadata', () => {
    expect(trainingProgramVersionListSelect).toEqual({
      id: true,
      programId: true,
      version: true,
      title: true,
      description: true,
      durationWeeks: true,
      status: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
    });
    expect(trainingProgramVersionListSelect).not.toHaveProperty('workouts');
  });

  it('only reads order fields for draft exercise and set reordering', () => {
    expect(trainingProgramExerciseOrderSelect).toEqual({
      id: true,
      sortOrder: true,
    });
    expect(trainingProgramSetOrderSelect).toEqual({
      id: true,
      setNumber: true,
    });
  });

  it('keeps draft access checks compact and independent of full version payload', () => {
    const workout = trainingProgramDraftAccessSelect.workouts.select;
    expect(workout.exercises.select.sets.select).toEqual({
      id: true,
      setNumber: true,
    });
    expect(workout.exercises.select).not.toHaveProperty('exerciseNameSnapshot');
  });

  it('does not select athlete emails in historical assignment responses', () => {
    expect(trainingProgramAssignmentHistoricalSelect).not.toHaveProperty('assignedBy');
    expect(trainingProgramAssignmentHistoricalSelect).not.toHaveProperty('endedBy');
    expect(trainingProgramAssignmentHistoricalSelect.athlete.select).not.toHaveProperty('email');
  });
});
