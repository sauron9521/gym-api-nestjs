import {
  bodyMeasurementStatisticsQuerySchema,
  statisticsRangeDays,
  statisticsUnits,
} from '../dto/body-measurement-statistics.schemas.js';

describe('body measurement statistics query', () => {
  it('defaults to weight in a 90-day range', () => {
    expect(bodyMeasurementStatisticsQuerySchema.parse({})).toEqual({
      metric: 'weightKg',
      range: '90d',
    });
  });

  it('accepts the available metric and period combinations', () => {
    for (const metric of ['weightKg', 'bodyFatPct', 'chestCm', 'waistCm',
      'hipsCm', 'armCm', 'thighCm']) {
      for (const range of ['7d', '30d', '90d']) {
        expect(bodyMeasurementStatisticsQuerySchema.safeParse({
          metric, range,
        }).success).toBe(true);
      }
    }
    expect(statisticsRangeDays['30d']).toBe(30);
    expect(statisticsUnits.bodyFatPct).toBe('%');
  });

  it('rejects unsupported metric, range and unrelated params', () => {
    for (const query of [
      { metric: 'passwordHash' },
      { metric: 'heightCm' },
      { range: 'all' },
      { range: '365d' },
      { userId: 'someone-else' },
    ]) {
      expect(bodyMeasurementStatisticsQuerySchema.safeParse(query).success)
        .toBe(false);
    }
  });
});
