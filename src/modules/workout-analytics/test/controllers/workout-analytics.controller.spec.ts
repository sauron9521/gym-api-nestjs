import { WorkoutAnalyticsController } from '../../controllers/workout-analytics.controller.js';
import { WorkoutAnalyticsService } from '../../services/workout-analytics.service.js';
import type { WorkoutAnalyticsQuery } from '../../dto/workout-analytics.schemas.js';
import type { WorkoutActor } from '#src/modules/workouts/types/workout.types';

describe('WorkoutAnalyticsController', () => {
  const service = {
    summary: vi.fn(),
    exercise: vi.fn(),
  };
  const athlete: WorkoutActor = { id: 'athlete-1', role: 'ATHLETE' };
  let controller: WorkoutAnalyticsController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new WorkoutAnalyticsController(
      service as unknown as WorkoutAnalyticsService,
    );
  });

  it('delegates summary with the current athlete and selected range', async () => {
    const query: WorkoutAnalyticsQuery = { range: '7d' };
    const response = { range: '7d', workoutCount: 3, daily: [] };
    service.summary.mockResolvedValue(response);

    await expect(controller.summary(athlete, query)).resolves.toBe(response);
    expect(service.summary).toHaveBeenCalledExactlyOnceWith(athlete, query);
    expect(service.exercise).not.toHaveBeenCalled();
  });

  it('delegates exercise history with the original actor, ID and range', async () => {
    const query: WorkoutAnalyticsQuery = { range: '90d' };
    const exerciseId = '11111111-1111-4111-8111-111111111111';
    const response = { exerciseId, workoutCount: 2, daily: [] };
    service.exercise.mockResolvedValue(response);

    await expect(controller.exercise(athlete, exerciseId, query))
      .resolves.toBe(response);
    expect(service.exercise)
      .toHaveBeenCalledExactlyOnceWith(athlete, exerciseId, query);
    expect(service.summary).not.toHaveBeenCalled();
  });

  it('preserves errors from the service without exposing extra data', async () => {
    const error = new Error('Access denied');
    const query: WorkoutAnalyticsQuery = { range: '30d' };
    service.summary.mockRejectedValue(error);

    await expect(controller.summary(athlete, query)).rejects.toBe(error);
    expect(service.summary).toHaveBeenCalledExactlyOnceWith(athlete, query);
  });
});
