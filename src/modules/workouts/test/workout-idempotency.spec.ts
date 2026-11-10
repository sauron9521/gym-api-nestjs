import { BadRequestException } from '@nestjs/common';

import { workoutIdempotency } from '../utils/workout-idempotency.js';

describe('workoutIdempotency', () => {
  const key = 'a382ec23-2681-4d5f-9697-c71e21636ed6';

  it('is optional for existing clients', () => {
    expect(workoutIdempotency(undefined, 'manual', { title: 'Workout' }))
      .toBeUndefined();
  });

  it('rejects invalid and blank keys', () => {
    for (const invalid of ['', 'short', 'contains whitespace', 'x'.repeat(129)]) {
      expect(() => workoutIdempotency(invalid, 'manual', {}))
        .toThrow(BadRequestException);
    }
  });

  it('creates the same fingerprint despite property ordering', () => {
    const a = workoutIdempotency(key, 'manual', {
      title: 'Workout',
      exercises: [{ exerciseId: 'exercise-1', sets: [{ plannedReps: 8 }] }],
      scheduledAt: new Date('2030-01-02T10:00:00.000Z'),
    });
    const b = workoutIdempotency(key, 'manual', {
      scheduledAt: '2030-01-02T10:00:00.000Z',
      exercises: [{ sets: [{ plannedReps: 8 }], exerciseId: 'exercise-1' }],
      title: 'Workout',
    });
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });

  it('isolates manual and program-based creation operations', () => {
    const input = { assignmentId: 'assignment-1' };
    const a = workoutIdempotency(key, 'manual', input);
    const b = workoutIdempotency(key, 'from-program', input);
    expect(a?.fingerprint).not.toBe(b?.fingerprint);
  });

  it('changes the fingerprint when a field changes', () => {
    const a = workoutIdempotency(key, 'manual', { title: 'Original' });
    const b = workoutIdempotency(key, 'manual', { title: 'Updated' });
    expect(a?.fingerprint).not.toBe(b?.fingerprint);
  });
  it('treats missing and explicit undefined properties as the same request', () => {
    const explicitUndefined = workoutIdempotency(key, 'manual', {
      title: 'Workout',
      notes: undefined,
      exercises: [{ exerciseId: 'exercise-1', notes: undefined }],
    });
    const omitted = workoutIdempotency(key, 'manual', {
      exercises: [{ exerciseId: 'exercise-1' }],
      title: 'Workout',
    });
    expect(explicitUndefined?.fingerprint).toBe(omitted?.fingerprint);
  });

  it('treats null differently from an omitted optional field', () => {
    const missing = workoutIdempotency(key, 'manual', { title: 'Workout' });
    const explicitNull = workoutIdempotency(key, 'manual', {
      title: 'Workout',
      notes: null,
    });
    expect(missing?.fingerprint).not.toBe(explicitNull?.fingerprint);
  });

  it('preserves exercise and set array ordering in request identity', () => {
    const first = workoutIdempotency(key, 'manual', {
      exercises: [
        { exerciseId: 'exercise-1', sets: [{ plannedReps: 8 }, { plannedReps: 10 }] },
        { exerciseId: 'exercise-2', sets: [{ plannedReps: 12 }] },
      ],
    });
    const reorderedSets = workoutIdempotency(key, 'manual', {
      exercises: [
        { exerciseId: 'exercise-1', sets: [{ plannedReps: 10 }, { plannedReps: 8 }] },
        { exerciseId: 'exercise-2', sets: [{ plannedReps: 12 }] },
      ],
    });
    const reorderedExercises = workoutIdempotency(key, 'manual', {
      exercises: [
        { exerciseId: 'exercise-2', sets: [{ plannedReps: 12 }] },
        { exerciseId: 'exercise-1', sets: [{ plannedReps: 8 }, { plannedReps: 10 }] },
      ],
    });
    expect(first?.fingerprint).not.toBe(reorderedSets?.fingerprint);
    expect(first?.fingerprint).not.toBe(reorderedExercises?.fingerprint);
  });

  it('accepts the shortest and longest valid keys but rejects non-ASCII input', () => {
    expect(workoutIdempotency('12345678', 'manual', {})?.key).toBe('12345678');
    expect(workoutIdempotency('a'.repeat(128), 'manual', {})?.key).toHaveLength(128);
    expect(() => workoutIdempotency('ключ12345678', 'manual', {}))
      .toThrow(BadRequestException);
    expect(() => workoutIdempotency('a'.repeat(129), 'manual', {}))
      .toThrow(BadRequestException);
  });

});
