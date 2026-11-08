import { BadRequestException, NotFoundException } from '@nestjs/common';

import { BodyMeasurementsRepository } from '../body-measurements.repository.js';
import { BodyMeasurementsService } from '../body-measurements.service.js';

describe('BodyMeasurementsService', () => {
  const repository = {
    create: vi.fn(),
    findMany: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  let service: BodyMeasurementsService;

  const record = {
    id: 'measurement-1',
    weightKg: { toString: () => '81.25' },
    bodyFatPct: null,
    chestCm: null,
    waistCm: null,
    hipsCm: null,
    armCm: null,
    thighCm: null,
    notes: null,
    measuredAt: new Date('2026-11-08T10:00:00.000Z'),
    createdAt: new Date('2026-11-08T10:00:00.000Z'),
    updatedAt: new Date('2026-11-08T10:00:00.000Z'),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    service = new BodyMeasurementsService(
      repository as unknown as BodyMeasurementsRepository,
    );
  });

  it('creates a metric for the authenticated user with normalized timestamp', async () => {
    repository.create.mockResolvedValue(record);
    const value = await service.create('athlete-1', {
      weightKg: 81.25,
      measuredAt: '2026-11-08T12:00:00+02:00',
    });

    expect(repository.create).toHaveBeenCalledWith('athlete-1', {
      weightKg: 81.25,
      measuredAt: new Date('2026-11-08T10:00:00.000Z'),
    });
    expect(value.weightKg).toBe(81.25);
    expect(value).not.toHaveProperty('userId');
  });

  it('rejects future timestamps', async () => {
    await expect(service.create('athlete-1', {
      weightKg: 81,
      measuredAt: '2099-01-01T00:00:00Z',
    })).rejects.toThrow(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('lists newest-first paginated records using its userId', async () => {
    repository.findMany.mockResolvedValue({
      data: [record],
      meta: { total: 1, skip: 10, take: 10, totalPages: 1 },
    });
    const result = await service.findMany('athlete-1', {
      page: 2, limit: 10,
    });
    expect(repository.findMany).toHaveBeenCalledWith('athlete-1', {
      skip: 10, take: 10,
    });
    expect(result.data[0]?.weightKg).toBe(81.25);
    expect(result.meta.total).toBe(1);
  });

  it('does not reveal a missing or foreign record', async () => {
    repository.findOne.mockResolvedValue(null);
    await expect(service.findOne('athlete-1', 'missing'))
      .rejects.toThrow(NotFoundException);
    repository.update.mockResolvedValue(null);
    await expect(service.update('athlete-1', 'missing', { weightKg: 80 }))
      .rejects.toThrow(NotFoundException);
    repository.remove.mockResolvedValue(false);
    await expect(service.remove('athlete-1', 'missing'))
      .rejects.toThrow(NotFoundException);
  });

  it('supports partial metric clears on update', async () => {
    repository.update.mockResolvedValue(record);
    await service.update('athlete-1', 'measurement-1', {
      waistCm: null,
      notes: 'New note',
    });
    expect(repository.update).toHaveBeenCalledWith(
      'athlete-1', 'measurement-1',
      { waistCm: null, notes: 'New note' },
    );
  });

  it('returns 204-compatible no-content on delete', async () => {
    repository.remove.mockResolvedValue(true);
    await expect(service.remove('athlete-1', 'measurement-1'))
      .resolves.toBeUndefined();
  });
});
