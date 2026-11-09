import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExerciseTrainerAccessService } from '../services/exercise-trainer-access.service.js';
import { ExerciseTrainerAccessRepository } from '../repositories/exercise-trainer-access.repository.js';
import type { ExerciseActor } from '../types/exercise.types.js';

describe('ExerciseTrainerAccessService', () => {
  const athlete: ExerciseActor = { id: 'athlete-1', role: 'ATHLETE' };
  const trainer: ExerciseActor = { id: 'trainer-1', role: 'TRAINER' };
  const admin: ExerciseActor = { id: 'admin-1', role: 'ADMIN' };

  const repository = {
    grant: vi.fn(),
    list: vi.fn(),
    revoke: vi.fn(),
  };
  let service: ExerciseTrainerAccessService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new ExerciseTrainerAccessService(
      repository as unknown as ExerciseTrainerAccessRepository,
    );
  });

  it('rejects non-athlete writers and readers', async () => {
    await expect(service.grant('exercise-1', trainer, 'trainer-2'))
      .rejects.toThrow(ForbiddenException);
    await expect(service.revoke('exercise-1', admin, 'trainer-2'))
      .rejects.toThrow(ForbiddenException);
    await expect(service.list('exercise-1', trainer))
      .rejects.toThrow(ForbiddenException);
    expect(repository.grant).not.toHaveBeenCalled();
    expect(repository.revoke).not.toHaveBeenCalled();
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('returns only the repository grant record', async () => {
    const grant = {
      id: 'grant-1',
      exerciseId: 'exercise-1',
      trainerId: 'trainer-1',
      grantedAt: new Date(),
      revokedAt: null,
    };
    repository.grant.mockResolvedValue({ status: 'GRANTED', grant });

    expect(await service.grant('exercise-1', athlete, 'trainer-1'))
      .toEqual(grant);
    expect(repository.grant).toHaveBeenCalledWith(
      'exercise-1', 'athlete-1', 'trainer-1',
    );
  });

  it.each([
    ['NOT_FOUND', NotFoundException],
    ['PRIVATE', ConflictException],
    ['NO_ACTIVE_RELATIONSHIP', ConflictException],
  ] as const)('rejects unsafe grant state %s', async (status, exception) => {
    repository.grant.mockResolvedValue({ status });
    await expect(service.grant('exercise-1', athlete, 'trainer-1'))
      .rejects.toThrow(exception);
  });

  it('returns active grants for owner', async () => {
    const grants = [{ trainerId: 'trainer-1' }];
    repository.list.mockResolvedValue(grants);
    expect(await service.list('exercise-1', athlete)).toEqual(grants);
    expect(repository.list).toHaveBeenCalledWith('exercise-1', 'athlete-1');
  });

  it('hides inaccessible exercise on list and revoke', async () => {
    repository.list.mockResolvedValue(null);
    repository.revoke.mockResolvedValue(false);
    await expect(service.list('exercise-1', athlete))
      .rejects.toThrow(NotFoundException);
    await expect(service.revoke('exercise-1', athlete, 'trainer-1'))
      .rejects.toThrow(NotFoundException);
  });

  it('allows idempotent revoke', async () => {
    repository.revoke.mockResolvedValue(true);
    await expect(service.revoke('exercise-1', athlete, 'trainer-1'))
      .resolves.toBeUndefined();
    expect(repository.revoke).toHaveBeenCalledWith(
      'exercise-1', 'athlete-1', 'trainer-1',
    );
  });
});
