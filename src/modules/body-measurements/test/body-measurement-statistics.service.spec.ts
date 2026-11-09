import { BodyMeasurementStatisticsRepository } from '../repositories/body-measurement-statistics.repository.js';
import { BodyMeasurementStatisticsService } from '../services/body-measurement-statistics.service.js';

describe('BodyMeasurementStatisticsService', () => {
  const repository = { readStatistics: vi.fn() };
  const date = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000);
  const makeRecord = (
    id: string, daysAgo: number, value: string | null,
  ) => ({
    id,
    measuredAt: date(daysAgo),
    weightKg: value,
    bodyFatPct: null,
    chestCm: null,
    waistCm: null,
    hipsCm: null,
    armCm: null,
    thighCm: null,
  });
  let service: BodyMeasurementStatisticsService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new BodyMeasurementStatisticsService(
      repository as unknown as BodyMeasurementStatisticsRepository,
    );
  });

  it('calculates overall and baseline differences for selected metric', async () => {
    repository.readStatistics.mockResolvedValue({
      first: makeRecord('first', 110, '80.00'),
      latest: makeRecord('last', 1, '81.25'),
      baselines: {
        '7d': makeRecord('week', 10, '80.50'),
        '30d': makeRecord('month', 50, '79.00'),
        '90d': makeRecord('quarter', 100, '78.00'),
      },
      series: [
        { id: 'week', measuredAt: date(10), value: '80.50' },
        { id: 'last', measuredAt: date(1), value: '81.25' },
      ],
    });

    const result = await service.getStatistics('athlete-1', {
      metric: 'weightKg',
      range: '30d',
    });

    expect(repository.readStatistics).toHaveBeenCalledWith(
      'athlete-1',
      'weightKg',
      expect.any(Date),
      30,
    );
    expect(result.overall).toEqual({
      delta: 1.25,
      percentChange: 1.56,
    });
    expect(result.changes['7d']).toMatchObject({
      delta: 0.75,
      percentChange: 0.93,
    });
    expect(result.changes['30d']).toMatchObject({
      delta: 2.25,
      percentChange: 2.85,
    });
    expect(result.series).toHaveLength(2);
    expect(result.series[1]?.value).toBe(81.25);
  });

  it('returns null comparisons for no measurements', async () => {
    repository.readStatistics.mockResolvedValue({
      first: null, latest: null,
      baselines: { '7d': null, '30d': null, '90d': null },
      series: [],
    });
    const result = await service.getStatistics('athlete-1', {
      metric: 'weightKg', range: '7d',
    });
    expect(result.first).toBeNull();
    expect(result.latest).toBeNull();
    expect(result.overall).toEqual({
      delta: null, percentChange: null,
    });
    expect(result.changes['7d']).toEqual({
      baseline: null, delta: null, percentChange: null,
    });
    expect(result.series).toEqual([]);
  });

  it('has no percentage change when the baseline is zero', async () => {
    repository.readStatistics.mockResolvedValue({
      first: {
        ...makeRecord('zero', 20, null), bodyFatPct: '0.00',
      },
      latest: {
        ...makeRecord('now', 1, null), bodyFatPct: '10.00',
      },
      baselines: {
        '7d': {
          ...makeRecord('zero', 20, null), bodyFatPct: '0.00',
        },
        '30d': null, '90d': null,
      },
      series: [],
    });
    const result = await service.getStatistics('athlete-1', {
      metric: 'bodyFatPct', range: '7d',
    });
    expect(result.overall).toEqual({
      delta: 10, percentChange: null,
    });
    expect(result.changes['7d']).toMatchObject({
      delta: 10, percentChange: null,
    });
  });

  it('does not report a stale latest point as a recent change', async () => {
    const record = makeRecord('old', 40, '81.00');
    repository.readStatistics.mockResolvedValue({
      first: record, latest: record,
      baselines: {
        '7d': record, '30d': record, '90d': null,
      },
      series: [],
    });
    const result = await service.getStatistics('athlete-1', {
      metric: 'weightKg', range: '7d',
    });
    expect(result.changes['7d'].delta).toBeNull();
    expect(result.overall.delta).toBe(0);
  });
});
