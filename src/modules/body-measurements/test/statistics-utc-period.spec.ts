import { utcSeriesStart } from '../utils/statistics-utc-period.js';

describe('utcSeriesStart', () => {
  it.each([
    ['2026-11-09T23:59:59.999Z', 7, '2026-11-03T00:00:00.000Z'],
    ['2026-11-09T00:00:00.000Z', 30, '2026-10-11T00:00:00.000Z'],
    ['2026-03-30T00:15:00.000Z', 7, '2026-03-24T00:00:00.000Z'],
    ['2024-03-01T12:00:00.000Z', 7, '2024-02-24T00:00:00.000Z'],
    ['2026-01-01T00:02:00.000Z', 90, '2025-10-04T00:00:00.000Z'],
  ])('includes %i UTC calendar dates around %s', (at, days, expected) => {
    const asOf = new Date(at);
    const original = asOf.getTime();
    expect(utcSeriesStart(asOf, days).toISOString()).toBe(expected);
    expect(asOf.getTime()).toBe(original);
  });
});
