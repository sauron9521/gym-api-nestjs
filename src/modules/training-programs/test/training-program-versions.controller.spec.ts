import { RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { TrainingProgramVersionsController } from '../training-program-versions.controller.js';
import { TrainingProgramAssignmentsController } from '../training-program-assignments.controller.js';
import { TrainingProgramsController } from '../training-programs.controller.js';
import { TrainingProgramsModule } from '../training-programs.module.js';
import { TrainingProgramsService } from '../services/training-programs.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

describe('TrainingProgramVersionsController', () => {
  const service = {
    findVersions: vi.fn(),
    createNextDraft: vi.fn(),
    findVersion: vi.fn(),
    updateDraftVersion: vi.fn(),
    publishVersion: vi.fn(),
  };
  let controller: TrainingProgramVersionsController;
  const actor: TrainingProgramActor = { id: 'trainer-1', role: 'TRAINER' };

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new TrainingProgramVersionsController(
      service as unknown as TrainingProgramsService,
    );
  });

  it('should publish a version', async () => {
    service.publishVersion.mockResolvedValue({
      id: 'version-1',
      status: 'PUBLISHED',
    });

    await controller.publishVersion('program-1', 'version-1', actor);

    expect(service.publishVersion).toHaveBeenCalledWith(
      'program-1',
      'version-1',
      actor,
    );
  });

  it('lists versions without changing the actor or program ID', async () => {
    service.findVersions.mockResolvedValue([]);
    await expect(controller.findVersions('program-1', actor)).resolves.toEqual([]);
    expect(service.findVersions).toHaveBeenCalledWith('program-1', actor);
  });

  it('creates a new draft from an existing program', async () => {
    service.createNextDraft.mockResolvedValue({ id: 'draft-2' });
    await expect(controller.createNextDraft('program-1', actor))
      .resolves.toEqual({ id: 'draft-2' });
    expect(service.createNextDraft).toHaveBeenCalledWith('program-1', actor);
  });

  it('retrieves a version with actor context', async () => {
    service.findVersion.mockResolvedValue({ id: 'version-1' });
    await expect(controller.findVersion('program-1', 'version-1', actor))
      .resolves.toEqual({ id: 'version-1' });
    expect(service.findVersion).toHaveBeenCalledWith('program-1', 'version-1', actor);
  });

  it('forwards draft updates to the service without altering DTOs', async () => {
    const body = { title: 'Updated draft' };
    service.updateDraftVersion.mockResolvedValue({ id: 'version-1', ...body });
    await expect(controller.updateDraftVersion('program-1', 'version-1', actor, body))
      .resolves.toMatchObject(body);
    expect(service.updateDraftVersion).toHaveBeenCalledWith(
      'program-1', 'version-1', actor, body,
    );
  });

  it('preserves controller registration order and route prefix', () => {
    const registered: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      TrainingProgramsModule,
    );
    expect(registered.indexOf(TrainingProgramAssignmentsController))
      .toBeLessThan(registered.indexOf(TrainingProgramVersionsController));
    expect(registered.indexOf(TrainingProgramVersionsController))
      .toBeLessThan(registered.indexOf(TrainingProgramsController));
    expect(Reflect.getMetadata(PATH_METADATA, TrainingProgramVersionsController))
      .toBe('training-programs');
  });

  it.each([
    ['findVersions', ':programId/versions', RequestMethod.GET],
    ['createNextDraft', ':programId/versions/drafts', RequestMethod.POST],
    ['findVersion', ':programId/versions/:versionId', RequestMethod.GET],
    ['updateDraftVersion', ':programId/versions/:versionId', RequestMethod.PATCH],
    ['publishVersion', ':programId/versions/:versionId/publish', RequestMethod.POST],
  ] as const)('preserves route metadata for %s', (handler, path, method) => {
    const action = TrainingProgramVersionsController.prototype[handler];
    expect(Reflect.getMetadata(PATH_METADATA, action)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, action)).toBe(method);
  });

  it('publishes with HTTP 200 rather than default POST 201', () => {
    expect(Reflect.getMetadata(
      HTTP_CODE_METADATA,
      TrainingProgramVersionsController.prototype.publishVersion,
    )).toBe(200);
  });
});
