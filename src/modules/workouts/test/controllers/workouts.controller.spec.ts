import { WorkoutsController } from '../../controllers/workouts.controller.js';
import { WorkoutsService } from '../../services/workouts.service.js';
import type { WorkoutActor } from '../../types/workout.types.js';

describe('WorkoutsController', () => {
  const service = {
    create: vi.fn(),
    findMany: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    start: vi.fn(),
    updateSet: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn(),
    createFromProgram: vi.fn(),
  };

  const athlete: WorkoutActor = { id: 'athlete-1', role: 'ATHLETE' };
  let controller: WorkoutsController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new WorkoutsController(service as unknown as WorkoutsService);
  });

  it('passes the workout creation DTO, athlete and Idempotency-Key unchanged', async () => {
    const body = { title: 'Strength day', exercises: [{
      exerciseId: 'exercise-1', sets: [{ plannedReps: 8 }],
    }] };
    const result = { id: 'workout-1' };
    service.create.mockResolvedValue(result);

    await expect(controller.create(athlete, body, 'creation-key-1')).resolves.toBe(result);
    expect(service.create).toHaveBeenCalledWith(athlete, body, 'creation-key-1');
  });

  it('preserves optional absence of Idempotency-Key on creation', async () => {
    service.create.mockResolvedValue({ id: 'workout-1' });
    const body = { title: 'Strength day', exercises: [{
      exerciseId: 'exercise-1', sets: [{ plannedReps: 8 }],
    }] };

    await controller.create(athlete, body);
    expect(service.create).toHaveBeenCalledWith(athlete, body, undefined);
  });

  it('delegates paginated list with the same query and actor', async () => {
    const query = { page: 1, limit: 20, view: 'summary' as const };
    const result = { data: [], meta: {} };
    service.findMany.mockResolvedValue(result);

    await expect(controller.findMany(athlete, query)).resolves.toBe(result);
    expect(service.findMany).toHaveBeenCalledWith(athlete, query);
  });

  it('delegates findOne with the same workout identifier', async () => {
    const result = { id: 'workout-1' };
    service.findOne.mockResolvedValue(result);

    await expect(controller.findOne('workout-1', athlete)).resolves.toBe(result);
    expect(service.findOne).toHaveBeenCalledWith('workout-1', athlete);
  });

  it('delegates workout update with the original body and athlete', async () => {
    const body = { title: 'Progression day' };
    const result = { id: 'workout-1' };
    service.update.mockResolvedValue(result);

    await expect(controller.update('workout-1', athlete, body)).resolves.toBe(result);
    expect(service.update).toHaveBeenCalledWith('workout-1', athlete, body);
  });

  it('delegates starting a workout to the service', async () => {
    const result = { id: 'workout-1', status: 'IN_PROGRESS' };
    service.start.mockResolvedValue(result);

    await expect(controller.start('workout-1', athlete)).resolves.toBe(result);
    expect(service.start).toHaveBeenCalledWith('workout-1', athlete);
  });

  it('delegates set updates with both resource ids and status DTO', async () => {
    const body = { status: 'COMPLETED' as const, actualReps: 8 };
    const result = { id: 'set-1', status: 'COMPLETED' };
    service.updateSet.mockResolvedValue(result);

    await expect(controller.updateSet('workout-1', 'set-1', athlete, body))
      .resolves.toBe(result);
    expect(service.updateSet).toHaveBeenCalledWith('workout-1', 'set-1', athlete, body);
  });

  it('delegates workout completion to the service', async () => {
    const result = { id: 'workout-1', status: 'COMPLETED' };
    service.complete.mockResolvedValue(result);

    await expect(controller.complete('workout-1', athlete)).resolves.toBe(result);
    expect(service.complete).toHaveBeenCalledWith('workout-1', athlete);
  });

  it('delegates cancellation without changing the actor', async () => {
    const result = { id: 'workout-1', status: 'CANCELLED' };
    service.cancel.mockResolvedValue(result);

    await expect(controller.cancel('workout-1', athlete)).resolves.toBe(result);
    expect(service.cancel).toHaveBeenCalledWith('workout-1', athlete);
  });

  it('preserves assignment DTO and Idempotency-Key on program-derived creation', async () => {
    const body = {
      assignmentId: '11111111-1111-4111-8111-111111111111',
      programWorkoutId: '22222222-2222-4222-8222-222222222222',
    };
    const result = { id: 'workout-from-program-1' };
    service.createFromProgram.mockResolvedValue(result);

    await expect(controller.createFromProgram(athlete, body, 'program-key-1'))
      .resolves.toBe(result);
    expect(service.createFromProgram)
      .toHaveBeenCalledWith(athlete, body, 'program-key-1');
  });
});
