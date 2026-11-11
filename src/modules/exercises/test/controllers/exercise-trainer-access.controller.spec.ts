import { RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { ExerciseTrainerAccessController } from '../../controllers/exercise-trainer-access.controller.js';
import { ExerciseTrainerAccessService } from '../../services/exercise-trainer-access.service.js';
import type { ExerciseActor } from '../../types/exercise.types.js';

describe('ExerciseTrainerAccessController', () => {
  const service = {
    list: vi.fn(),
    grant: vi.fn(),
    revoke: vi.fn(),
  };

  const athlete: ExerciseActor = { id: 'athlete-1', role: 'ATHLETE' };
  const exerciseId = 'exercise-1';
  const trainerId = '11111111-1111-4111-8111-111111111111';
  let controller: ExerciseTrainerAccessController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new ExerciseTrainerAccessController(
      service as unknown as ExerciseTrainerAccessService,
    );
  });

  it('delegates the access list to the service with the authenticated athlete', async () => {
    const result = [{ trainerId }];
    service.list.mockResolvedValue(result);

    await expect(controller.list(exerciseId, athlete)).resolves.toBe(result);
    expect(service.list).toHaveBeenCalledWith(exerciseId, athlete);
  });

  it('delegates trainer grants with a validated DTO trainer ID', async () => {
    const body = { trainerId };
    const result = { id: 'grant-1', trainerId };
    service.grant.mockResolvedValue(result);

    await expect(controller.grant(exerciseId, athlete, body)).resolves.toBe(result);
    expect(service.grant).toHaveBeenCalledWith(exerciseId, athlete, trainerId);
  });

  it('delegates trainer revocation with the supplied actor and IDs', async () => {
    service.revoke.mockResolvedValue(undefined);

    await expect(controller.revoke(exerciseId, trainerId, athlete)).resolves.toBeUndefined();
    expect(service.revoke).toHaveBeenCalledWith(exerciseId, athlete, trainerId);
  });

  it('retains nested trainer-access routes and HTTP status overrides', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ExerciseTrainerAccessController))
      .toBe('exercises/:id/trainer-access');
    const methods = ExerciseTrainerAccessController.prototype;
    const getHandler = (name: string) =>
      Object.getOwnPropertyDescriptor(methods, name)?.value;
    expect(Reflect.getMetadata(METHOD_METADATA, getHandler('list'))).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(METHOD_METADATA, getHandler('grant'))).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(METHOD_METADATA, getHandler('revoke'))).toBe(RequestMethod.DELETE);
    expect(Reflect.getMetadata(PATH_METADATA, getHandler('revoke'))).toBe(':trainerId');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, getHandler('grant'))).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, getHandler('revoke'))).toBe(204);
  });
});
