import { Prisma } from '#prisma/client';
import type { PrismaService } from '#src/infra/database/index';

import { BodyMeasurementStatisticsRepository } from '../repositories/body-measurement-statistics.repository.js';

describe('BodyMeasurementStatisticsRepository snapshot', () => {
  it('runs every component of the statistics response in one repeatable-read transaction', async () => {
    const tx = {
      bodyMeasurement: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const db = {
      bodyMeasurement: {
        findFirst: vi.fn(() => { throw new Error('outside transaction'); }),
      },
      $queryRaw: vi.fn(() => { throw new Error('outside transaction'); }),
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) =>
        run(tx),
      ),
    };
    const repository = new BodyMeasurementStatisticsRepository(
      db as unknown as PrismaService,
    );
    const asOf = new Date('2026-03-30T00:30:00.000Z');

    const result = await repository.readStatistics(
      'user-123', 'weightKg', asOf, 7,
    );

    expect(db.$transaction).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    expect(tx.bodyMeasurement.findFirst).toHaveBeenCalledTimes(5);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(db.bodyMeasurement.findFirst).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(result).toEqual({
      first: null,
      latest: null,
      baselines: { '7d': null, '30d': null, '90d': null },
      series: [],
    });

    const sql = tx.$queryRaw.mock.calls[0]?.[0] as {
      strings: string[];
      values: unknown[];
    };
    expect(sql.strings.join('')).toContain("AT TIME ZONE 'UTC'");
    expect(sql.values.some(
      (value) => value instanceof Date &&
        value.toISOString() === '2026-03-24T00:00:00.000Z',
    )).toBe(true);
    expect(sql.values.some(
      (value) => value instanceof Date &&
        value.getTime() === asOf.getTime(),
    )).toBe(true);
    expect(sql.values).toContain('user-123');
  });
});
