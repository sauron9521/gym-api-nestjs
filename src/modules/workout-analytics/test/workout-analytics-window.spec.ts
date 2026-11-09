import { describe, expect, it } from 'vitest';

import { workoutAnalyticsWindow } from '../utils/workout-analytics-window.js';

describe('workoutAnalyticsWindow', () => {
  it.each([
    ['2026-11-09T23:59:59.000Z', 7, '2026-11-03T00:00:00.000Z'],
    ['2026-03-30T00:10:00.000Z', 7, '2026-03-24T00:00:00.000Z'],
    ['2024-03-01T12:30:00.000Z', 30, '2024-02-01T00:00:00.000Z'],
  ])('covers %s over %i UTC dates', (value, days, expected) => {
    const now = new Date(value);
    expect(workoutAnalyticsWindow(now, days).toISOString()).toBe(expected);
    expect(now.toISOString()).toBe(value);
  });
});
