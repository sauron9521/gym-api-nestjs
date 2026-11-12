import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '#prisma/client';
import { TrainingProgramVersionService } from '../services/training-program-version.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

describe('TrainingProgramVersionService', () => {
  const repository = {
    findVersions: vi.fn(),
    findVersionById: vi.fn(),
    findDraftVersion: vi.fn(),
    createDraftFromLatestPublished: vi.fn(),
    updateVersion: vi.fn(),
    publishVersion: vi.fn(),
  };
  const crud = { findOne: vi.fn() };
  const trainer: TrainingProgramActor = { id: 'trainer-1', role: 'TRAINER' };
  const athlete: TrainingProgramActor = { id: 'athlete-1', role: 'ATHLETE' };
  const ids = ['program-1', 'version-1'] as const;
  const draft = () => ({
    id: 'version-1',
    status: 'DRAFT' as const,
    durationWeeks: 4,
    workouts: [{
      id: 'workout-1',
      weekNumber: 3,
      exercises: [{ id: 'exercise-1', sets: [{ id: 'set-1' }] }],
    }],
  });
  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('Concurrent state change', {
      code, clientVersion: '7.0.0',
    });
  let service: TrainingProgramVersionService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new TrainingProgramVersionService(repository as never, crud as never);
    crud.findOne.mockResolvedValue({ id: ids[0], status: 'DRAFT' });
    repository.findVersionById.mockResolvedValue(draft());
  });

  it('lists versions only after a program ownership lookup', async () => {
    const versions = [{ id: ids[1], version: 1 }];
    repository.findVersions.mockResolvedValue(versions);
    await expect(service.findVersions(ids[0], trainer)).resolves.toBe(versions);
    expect(crud.findOne).toHaveBeenCalledExactlyOnceWith(ids[0], trainer);
    expect(repository.findVersions).toHaveBeenCalledExactlyOnceWith(ids[0]);
    expect(crud.findOne.mock.invocationCallOrder[0])
      .toBeLessThan(repository.findVersions.mock.invocationCallOrder[0]!);
  });

  it('does not list versions when program access is denied', async () => {
    crud.findOne.mockRejectedValue(new ForbiddenException());
    await expect(service.findVersions(ids[0], athlete))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findVersions).not.toHaveBeenCalled();
  });

  it('scopes the version lookup to the requested program', async () => {
    await expect(service.findVersion(...ids, trainer)).resolves.toEqual(draft());
    expect(repository.findVersionById).toHaveBeenCalledExactlyOnceWith(
      ids[1], { programId: ids[0] },
    );
  });

  it('does not expose versions from another program', async () => {
    repository.findVersionById.mockResolvedValue(null);
    await expect(service.findVersion(...ids, trainer))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not fetch a version when program access is denied', async () => {
    crud.findOne.mockRejectedValue(new ForbiddenException());
    await expect(service.findVersion(...ids, athlete))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findVersionById).not.toHaveBeenCalled();
  });

  it('creates a draft from the latest published version when no draft exists', async () => {
    repository.findDraftVersion.mockResolvedValue(null);
    const created = { id: 'version-2', status: 'DRAFT' };
    repository.createDraftFromLatestPublished.mockResolvedValue(created);
    await expect(service.createNextDraft(ids[0], trainer)).resolves.toBe(created);
    expect(repository.findDraftVersion).toHaveBeenCalledExactlyOnceWith(ids[0]);
    expect(repository.createDraftFromLatestPublished)
      .toHaveBeenCalledExactlyOnceWith(ids[0]);
  });

  it('refuses to clone an archived program', async () => {
    crud.findOne.mockResolvedValue({ id: ids[0], status: 'ARCHIVED' });
    await expect(service.createNextDraft(ids[0], trainer))
      .rejects.toBeInstanceOf(ConflictException);
    expect(repository.findDraftVersion).not.toHaveBeenCalled();
  });

  it('does not clone when an editable draft already exists', async () => {
    repository.findDraftVersion.mockResolvedValue(draft());
    await expect(service.createNextDraft(ids[0], trainer))
      .rejects.toBeInstanceOf(ConflictException);
    expect(repository.createDraftFromLatestPublished).not.toHaveBeenCalled();
  });

  it('rejects a clone when no published version exists', async () => {
    repository.findDraftVersion.mockResolvedValue(null);
    repository.createDraftFromLatestPublished.mockResolvedValue(null);
    await expect(service.createNextDraft(ids[0], trainer))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('maps a concurrently created draft to a conflict', async () => {
    repository.findDraftVersion.mockResolvedValue(null);
    repository.createDraftFromLatestPublished.mockRejectedValue(prismaError('P2002'));
    await expect(service.createNextDraft(ids[0], trainer))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('preserves unexpected clone failures for diagnostics', async () => {
    const failure = new Error('database unavailable');
    repository.findDraftVersion.mockResolvedValue(null);
    repository.createDraftFromLatestPublished.mockRejectedValue(failure);
    await expect(service.createNextDraft(ids[0], trainer)).rejects.toBe(failure);
  });

  it('rejects changes to archived programs before loading a version', async () => {
    crud.findOne.mockResolvedValue({ id: ids[0], status: 'ARCHIVED' });
    await expect(service.updateDraftVersion(...ids, trainer, { title: 'New' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(repository.findVersionById).not.toHaveBeenCalled();
  });

  it('rejects editing published versions', async () => {
    repository.findVersionById.mockResolvedValue({ ...draft(), status: 'PUBLISHED' });
    await expect(service.updateDraftVersion(...ids, trainer, { title: 'New' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(repository.updateVersion).not.toHaveBeenCalled();
  });

  it('rejects a draft update without any fields', async () => {
    await expect(service.updateDraftVersion(...ids, trainer, {}))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.updateVersion).not.toHaveBeenCalled();
  });

  it('refuses to shorten duration past a scheduled workout', async () => {
    await expect(service.updateDraftVersion(...ids, trainer, { durationWeeks: 2 }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.updateVersion).not.toHaveBeenCalled();
  });

  it('allows the workout on the last week and preserves null as unbounded', async () => {
    const updated = { id: ids[1], durationWeeks: 3 };
    repository.updateVersion.mockResolvedValue(updated);
    await expect(service.updateDraftVersion(...ids, trainer, { durationWeeks: 3 }))
      .resolves.toBe(updated);
    await service.updateDraftVersion(...ids, trainer, { durationWeeks: null });
    expect(repository.updateVersion).toHaveBeenNthCalledWith(1, {
      id: ids[1], programId: ids[0], status: 'DRAFT',
    }, { durationWeeks: 3 });
    expect(repository.updateVersion).toHaveBeenNthCalledWith(2, {
      id: ids[1], programId: ids[0], status: 'DRAFT',
    }, { durationWeeks: null });
  });

  it('trims titles, normalizes blank descriptions and keeps unrelated fields untouched', async () => {
    await service.updateDraftVersion(...ids, trainer, {
      title: '  Progressive overload  ', description: '   ',
    });
    expect(repository.updateVersion).toHaveBeenCalledExactlyOnceWith({
      id: ids[1], programId: ids[0], status: 'DRAFT',
    }, { title: 'Progressive overload', description: null });
  });

  it('normalizes a non-empty description and leaves other values unmodified', async () => {
    await service.updateDraftVersion(...ids, trainer, {
      description: '  Focus on technique  ', durationWeeks: 5,
    });
    expect(repository.updateVersion).toHaveBeenCalledExactlyOnceWith({
      id: ids[1], programId: ids[0], status: 'DRAFT',
    }, { description: 'Focus on technique', durationWeeks: 5 });
  });

  it('maps a concurrent draft publication during update to conflict', async () => {
    repository.updateVersion.mockRejectedValue(prismaError('P2025'));
    await expect(service.updateDraftVersion(...ids, trainer, { title: 'New' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('does not hide unexpected update failures', async () => {
    const failure = new Error('connection closed');
    repository.updateVersion.mockRejectedValue(failure);
    await expect(service.updateDraftVersion(...ids, trainer, { title: 'New' }))
      .rejects.toBe(failure);
  });

  it('refuses to publish archived programs before accessing a draft', async () => {
    crud.findOne.mockResolvedValue({ id: ids[0], status: 'ARCHIVED' });
    await expect(service.publishVersion(...ids, trainer))
      .rejects.toBeInstanceOf(ConflictException);
    expect(repository.findVersionById).not.toHaveBeenCalled();
    expect(repository.publishVersion).not.toHaveBeenCalled();
  });

  it('refuses to publish an already published version', async () => {
    repository.findVersionById.mockResolvedValue({ ...draft(), status: 'PUBLISHED' });
    await expect(service.publishVersion(...ids, trainer))
      .rejects.toBeInstanceOf(ConflictException);
    expect(repository.publishVersion).not.toHaveBeenCalled();
  });

  it('rejects an empty draft before attempting the publishing transaction', async () => {
    repository.findVersionById.mockResolvedValue({ ...draft(), workouts: [] });
    await expect(service.publishVersion(...ids, trainer))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.publishVersion).not.toHaveBeenCalled();
  });

  it('rejects a draft with missing sets before committing publication', async () => {
    repository.findVersionById.mockResolvedValue({
      ...draft(), workouts: [{
        weekNumber: 1, exercises: [{ sets: [] }],
      }],
    });
    await expect(service.publishVersion(...ids, trainer))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.publishVersion).not.toHaveBeenCalled();
  });

  it('returns the published snapshot from the repository', async () => {
    const published = { id: ids[1], status: 'PUBLISHED' };
    repository.publishVersion.mockResolvedValue(published);
    await expect(service.publishVersion(...ids, trainer)).resolves.toBe(published);
    expect(repository.publishVersion).toHaveBeenCalledExactlyOnceWith(...ids);
  });

  it('maps an obsolete draft discovered during the publishing transaction to conflict', async () => {
    repository.publishVersion.mockResolvedValue(null);
    await expect(service.publishVersion(...ids, trainer))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('does not allow an unauthorized trainer to publish any version', async () => {
    crud.findOne.mockRejectedValue(new NotFoundException());
    await expect(service.publishVersion(...ids, athlete))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(repository.publishVersion).not.toHaveBeenCalled();
  });
});
