import {
  trainingProgramAssignmentDetailsSelect,
  trainingProgramAssignmentHistoricalSelect,
  trainingProgramAssignmentSelect,
  trainingProgramAssignmentSummarySelect,
} from '../selects/training-program-assignment.select.js';
import { trainingProgramDraftAccessSelect } from '../selects/training-program-access.select.js';

describe('Training Programs assignment projection boundaries', () => {
  it('excludes workout instances from the summary list projection', () => {
    expect(trainingProgramAssignmentSummarySelect.workouts).toBe(false);
    expect(trainingProgramAssignmentSelect.workouts).toEqual({
      select: {
        id: true,
        title: true,
        status: true,
        scheduledAt: true,
        startedAt: true,
        completedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('retains full published program details only in the explicit details projection', () => {
    const details = trainingProgramAssignmentDetailsSelect.version.select;
    expect(details.workouts).toBeDefined();
    expect(details.workouts.select.exercises.select.sets.select).toHaveProperty(
      'plannedWeightKg',
      true,
    );

    const summary = trainingProgramAssignmentSummarySelect.version.select;
    expect(summary).not.toHaveProperty('workouts');
  });

  it('never selects private contacts or session metadata for historical assignments', () => {
    const historical = trainingProgramAssignmentHistoricalSelect;
    expect(historical).not.toHaveProperty('assignedBy');
    expect(historical).not.toHaveProperty('endedBy');
    expect(historical).not.toHaveProperty('workouts');
    expect(historical.version.select).not.toHaveProperty('program');
    expect(historical.version.select).not.toHaveProperty('workouts');
    expect(historical.athlete.select).toEqual({ id: true, role: true });
  });

  it('keeps program draft edit checks limited to IDs and ordering fields', () => {
    const select = trainingProgramDraftAccessSelect;
    const workouts = select.workouts.select;
    const exercises = workouts.exercises.select;

    expect(select).not.toHaveProperty('description');
    expect(workouts).toEqual({
      id: true,
      exercises: {
        select: {
          id: true,
          sortOrder: true,
          sets: { select: { id: true, setNumber: true } },
        },
      },
    });
    expect(exercises).not.toHaveProperty('exerciseNameSnapshot');
    expect(exercises.sets.select).not.toHaveProperty('plannedWeightKg');
  });
});
