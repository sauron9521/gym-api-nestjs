import { describe, expect, it } from 'vitest';

import {
  getMetricDifference,
  mapMetricPoint,
} from '../mappers/body-measurement-statistics.mapper.js';
import type { MeasurementStatisticsRecord } from '../types/body-measurement.types.js';

describe('body measurement statistics mappers', () => {
  it('maps selected metric, including valid zero, without extra properties', () => {
    const record = {
      id: 'measurement-1',
      measuredAt: new Date('2026-11-08T10:00:00.000Z'),
      bodyFatPct: { toString: () => '0.00' },
      weightKg: null,
    } as MeasurementStatisticsRecord;

    expect(mapMetricPoint(record, 'bodyFatPct')).toEqual({
      id: record.id,
      measuredAt: record.measuredAt,
      value: 0,
    });
    expect(mapMetricPoint(record, 'weightKg')).toBeNull();
    expect(mapMetricPoint(null, 'bodyFatPct')).toBeNull();
  });

  it('returns null changes without both points', () => {
    const point = {
      id: 'one',
      measuredAt: new Date('2026-11-08T10:00:00Z'),
      value: 81,
    };
    expect(getMetricDifference(null, point)).toEqual({
      delta: null,
      percentChange: null,
    });
    expect(getMetricDifference(point, null)).toEqual({
      delta: null,
      percentChange: null,
    });
  });

  it('rounds deltas and percent changes using the established API semantics', () => {
    const measuredAt = new Date('2026-11-08T10:00:00Z');
    const from = { id: 'one', measuredAt, value: 80 };
    const to = { id: 'two', measuredAt, value: 81.25 };
    expect(getMetricDifference(from, to)).toEqual({
      delta: 1.25,
      percentChange: 1.56,
    });
  });

  it('does not divide by a zero baseline', () => {
    const measuredAt = new Date('2026-11-08T10:00:00Z');
    expect(getMetricDifference(
      { id: 'one', measuredAt, value: 0 },
      { id: 'two', measuredAt, value: 10 },
    )).toEqual({
      delta: 10,
      percentChange: null,
    });
  });
});
