import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '#prisma/client';
import { TrainingProgramWorkoutService } from '../services/training-program-workout.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

describe('TrainingProgramWorkoutService', () => {
  const repository = {
    createWorkout: vi.fn(),
    updateWorkout: vi.fn(),
    deleteWorkout: vi.fn(),
  };
  const access = { assertEditableDraft: vi.fn() };
  const actor: TrainingProgramActor = { id: 'trainer-1', role: 'TRAINER' };
  const ids = ['program-1', 'version-1'] as const;
  const input = { weekNumber: 2, dayNumber: 1, title: 'Push' };
  const draft = () => ({
    durationWeeks: 4,
    workouts: [{ id: 'workout-1' }],
  });
  const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError(
    'Concurrent update', { code, clientVersion: '7.10.1' },
  );
  let service: TrainingProgramWorkoutService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new TrainingProgramWorkoutService(repository as never, access as never);
    access.assertEditableDraft.mockResolvedValue(draft());
  });

  it('creates a workout only within the editable draft', async () => {
    const created = { id: 'workout-1' };
    repository.createWorkout.mockResolvedValue(created);

    await expect(service.createWorkout(actor, ...ids, input)).resolves.toBe(created);
    expect(access.assertEditableDraft).toHaveBeenCalledExactlyOnceWith(actor, ...ids);
    expect(repository.createWorkout).toHaveBeenCalledExactlyOnceWith(...ids, input);
  });

  it('permits unbounded duration when durationWeeks is null', async () => {
    access.assertEditableDraft.mockResolvedValue({ ...draft(), durationWeeks: null });
    await service.createWorkout(actor, ...ids, { ...input, weekNumber: 99 });
    expect(repository.createWorkout).toHaveBeenCalledOnce();
  });

  it('rejects workouts beyond the configured duration before writing', async () => {
    await expect(service.createWorkout(actor, ...ids, { ...input, weekNumber: 5 }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createWorkout).not.toHaveBeenCalled();
  });

  it.each(['P2002', 'P2025'] as const)(
    'maps a concurrent create %s to conflict', async (code) => {
      repository.createWorkout.mockRejectedValue(prismaError(code));
      await expect(service.createWorkout(actor, ...ids, input))
        .rejects.toBeInstanceOf(ConflictException);
    },
  );

  it('propagates unrelated create errors without hiding them', async () => {
    const error = new Error('connection lost');
    repository.createWorkout.mockRejectedValue(error);
    await expect(service.createWorkout(actor, ...ids, input)).rejects.toBe(error);
  });

  it('never writes if the editable-draft authorization fails', async () => {
    access.assertEditableDraft.mockRejectedValue(new ForbiddenException());
    await expect(service.createWorkout(actor, ...ids, input))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.createWorkout).not.toHaveBeenCalled();
  });

  it('rejects an empty update before reading the draft', async () => {
    await expect(service.updateWorkout(actor, ...ids, 'workout-1', {}))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(access.assertEditableDraft).not.toHaveBeenCalled();
  });

  it('rejects an updated week beyond duration, but permits an unchanged week', async () => {
    await expect(service.updateWorkout(actor, ...ids, 'workout-1', { weekNumber: 5 }))
      .rejects.toBeInstanceOf(BadRequestException);
    await service.updateWorkout(actor, ...ids, 'workout-1', { title: 'Updated' });
    expect(repository.updateWorkout).toHaveBeenCalledExactlyOnceWith(
      ...ids, 'workout-1', { title: 'Updated' },
    );
  });

  it('allows editing a week when duration is unlimited', async () => {
    access.assertEditableDraft.mockResolvedValue({ ...draft(), durationWeeks: null });
    await service.updateWorkout(actor, ...ids, 'workout-1', { weekNumber: 50 });
    expect(repository.updateWorkout).toHaveBeenCalledOnce();
  });

  it('hides a workout that is not in the selected draft', async () => {
    await expect(service.updateWorkout(actor, ...ids, 'other-workout', { title: 'X' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(repository.updateWorkout).not.toHaveBeenCalled();
  });

  it.each(['P2002', 'P2025'] as const)(
    'maps an update %s to conflict', async (code) => {
      repository.updateWorkout.mockRejectedValue(prismaError(code));
      await expect(service.updateWorkout(actor, ...ids, 'workout-1', { title: 'X' }))
        .rejects.toBeInstanceOf(ConflictException);
    },
  );

  it('returns the updated workout unchanged', async () => {
    const result = { id: 'version-1', workouts: [{ id: 'workout-1' }] };
    repository.updateWorkout.mockResolvedValue(result);
    await expect(service.updateWorkout(actor, ...ids, 'workout-1', { title: 'X' }))
      .resolves.toBe(result);
  });

  it('hides an unknown workout on deletion', async () => {
    await expect(service.deleteWorkout(actor, ...ids, 'missing'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(repository.deleteWorkout).not.toHaveBeenCalled();
  });

  it('deletes only a workout of the editable draft', async () => {
    const result = { id: 'version-1', workouts: [] };
    repository.deleteWorkout.mockResolvedValue(result);
    await expect(service.deleteWorkout(actor, ...ids, 'workout-1')).resolves.toBe(result);
    expect(repository.deleteWorkout).toHaveBeenCalledExactlyOnceWith(...ids, 'workout-1');
  });

  it('maps a concurrent draft deletion to conflict', async () => {
    repository.deleteWorkout.mockRejectedValue(prismaError('P2025'));
    await expect(service.deleteWorkout(actor, ...ids, 'workout-1'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('does not suppress unexpected deletion errors', async () => {
    const error = new Error('database unavailable');
    repository.deleteWorkout.mockRejectedValue(error);
    await expect(service.deleteWorkout(actor, ...ids, 'workout-1')).rejects.toBe(error);
  });
});
