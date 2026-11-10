import { BodyMeasurementsController } from '../../controllers/body-measurements.controller.js';
import { BodyMeasurementsService } from '../../services/body-measurements.service.js';
import { BodyMeasurementStatisticsService } from '../../services/body-measurement-statistics.service.js';

describe('BodyMeasurementsController', () => {
  const service = {
    create: vi.fn(),
    findMany: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  const statisticsService = {
    getStatistics: vi.fn(),
  };
  const actor = { id: 'athlete-1' };
  let controller: BodyMeasurementsController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new BodyMeasurementsController(
      service as unknown as BodyMeasurementsService,
      statisticsService as unknown as BodyMeasurementStatisticsService,
    );
  });

  it('passes the authenticated user ID and new measurement unchanged', async () => {
    const input = { weightKg: 81.25, notes: 'Morning measurement' };
    const result = { id: 'measurement-1', ...input };
    service.create.mockResolvedValue(result);

    await expect(controller.create(actor, input)).resolves.toBe(result);
    expect(service.create).toHaveBeenCalledWith(actor.id, input);
    expect(service.create).toHaveBeenCalledTimes(1);
  });

  it('uses authenticated user ID for paginated history', async () => {
    const query = { page: 2, limit: 10 };
    const result = { data: [], meta: { total: 0 } };
    service.findMany.mockResolvedValue(result);

    await expect(controller.findMany(actor, query)).resolves.toBe(result);
    expect(service.findMany).toHaveBeenCalledWith(actor.id, query);
  });

  it('delegates the statistics query to the statistics service, scoped by actor ID', async () => {
    const query = { metric: 'weightKg' as const, range: '90d' as const };
    const result = { metric: 'weightKg', series: [] };
    statisticsService.getStatistics.mockResolvedValue(result);

    await expect(controller.statistics(actor, query)).resolves.toBe(result);
    expect(statisticsService.getStatistics).toHaveBeenCalledWith(actor.id, query);
    expect(service.findOne).not.toHaveBeenCalled();
  });

  it('looks up a single measurement for the authenticated user', async () => {
    const result = { id: 'measurement-1', weightKg: 81.25 };
    service.findOne.mockResolvedValue(result);

    await expect(controller.findOne(actor, 'measurement-1')).resolves.toBe(result);
    expect(service.findOne).toHaveBeenCalledWith(actor.id, 'measurement-1');
  });

  it('passes partial updates with the measurement ID and authenticated user ID', async () => {
    const input = { weightKg: 81.5 };
    const result = { id: 'measurement-1', ...input };
    service.update.mockResolvedValue(result);

    await expect(controller.update(actor, 'measurement-1', input)).resolves.toBe(result);
    expect(service.update).toHaveBeenCalledWith(actor.id, 'measurement-1', input);
  });

  it('delegates record deletion with the authenticated user ID', async () => {
    service.remove.mockResolvedValue(undefined);

    await expect(controller.remove(actor, 'measurement-1')).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith(actor.id, 'measurement-1');
  });

  it('propagates service errors instead of falling back to another actor', async () => {
    const error = new Error('Measurement not found');
    service.findOne.mockRejectedValue(error);

    await expect(controller.findOne(actor, 'missing-id')).rejects.toBe(error);
    expect(service.findOne).toHaveBeenCalledWith(actor.id, 'missing-id');
  });
});
