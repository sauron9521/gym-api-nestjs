import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '#prisma/client';
import { TrainingProgramCrudService } from '../services/training-program-crud.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

describe('TrainingProgramCrudService', () => {
  const repository = {
    createProgramWithDraft: vi.fn(),
    findMany: vi.fn(),
    findProgramById: vi.fn(),
    updateProgram: vi.fn(),
  };
  const access = { assertTrainer: vi.fn() };
  const trainer: TrainingProgramActor = { id: 'trainer-1', role: 'TRAINER' };
  const athlete: TrainingProgramActor = { id: 'athlete-1', role: 'ATHLETE' };
  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('Write conflict', {
      code,
      clientVersion: '7.0.0',
    });
  const program = { id: 'program-1', trainerId: trainer.id, status: 'DRAFT' };
  let service: TrainingProgramCrudService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new TrainingProgramCrudService(repository as never, access as never);
    access.assertTrainer.mockImplementation((actor: TrainingProgramActor) => {
      if (actor.role !== 'TRAINER') throw new ForbiddenException();
    });
    repository.findProgramById.mockResolvedValue(program);
  });

  it('normalizes whitespace and preserves optional program properties on creation', async () => {
    const result = { id: 'program-1' };
    repository.createProgramWithDraft.mockResolvedValue(result);
    await expect(service.create(trainer, {
      title: '  Full Body  ',
      description: '  Beginner  ',
      durationWeeks: 6,
    })).resolves.toBe(result);
    expect(access.assertTrainer).toHaveBeenCalledExactlyOnceWith(trainer);
    expect(repository.createProgramWithDraft).toHaveBeenCalledExactlyOnceWith({
      trainerId: 'trainer-1', title: 'Full Body',
      description: 'Beginner', durationWeeks: 6,
    });
  });

  it.each([
    { description: undefined, durationWeeks: undefined },
    { description: '', durationWeeks: null },
    { description: '   ', durationWeeks: null },
  ])('uses nulls for omitted or blank optional fields %j', async (fields) => {
    await service.create(trainer, { title: 'Push', ...fields });
    expect(repository.createProgramWithDraft).toHaveBeenCalledExactlyOnceWith({
      trainerId: trainer.id, title: 'Push',
      description: null, durationWeeks: null,
    });
  });

  it('denies creation to a non-trainer without writing', async () => {
    await expect(service.create(athlete, { title: 'No' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.createProgramWithDraft).not.toHaveBeenCalled();
  });

  it('translates a missing trainer FK to not found', async () => {
    repository.createProgramWithDraft.mockRejectedValue(prismaError('P2003'));
    await expect(service.create(trainer, { title: 'Push' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not mask an unexpected create error', async () => {
    const failure = new Error('Database unavailable');
    repository.createProgramWithDraft.mockRejectedValue(failure);
    await expect(service.create(trainer, { title: 'Push' })).rejects.toBe(failure);
  });

  it('scopes paginated lists to trainer and optional status', async () => {
    const response = { data: [program], meta: { total: 1 } };
    repository.findMany.mockResolvedValue(response);
    await expect(service.findMany(trainer, { page: 3, limit: 10, status: 'DRAFT' }))
      .resolves.toBe(response);
    expect(repository.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { trainerId: trainer.id, status: 'DRAFT' },
      skip: 20, take: 10,
    });
  });

  it('does not send an absent status as a filter', async () => {
    await service.findMany(trainer, { page: 1, limit: 100 });
    expect(repository.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { trainerId: trainer.id }, skip: 0, take: 100,
    });
  });

  it.each([
    { page: 0, limit: 10 },
    { page: -1, limit: 10 },
    { page: 1.25, limit: 10 },
    { page: Number.NaN, limit: 10 },
    { page: Number.POSITIVE_INFINITY, limit: 10 },
    { page: 1, limit: 0 },
    { page: 1, limit: -2 },
    { page: 1, limit: 10.5 },
    { page: 1, limit: 101 },
    { page: 1, limit: Number.NaN },
  ])('rejects malformed pagination %j without querying the database', async (query) => {
    await expect(service.findMany(trainer, query))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.findMany).not.toHaveBeenCalled();
  });

  it('checks trainer role before attempting list access', async () => {
    await expect(service.findMany(athlete, { page: 1, limit: 10 }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findMany).not.toHaveBeenCalled();
  });

  it('returns only a program scoped to the authenticated trainer', async () => {
    await expect(service.findOne('program-1', trainer)).resolves.toBe(program);
    expect(repository.findProgramById).toHaveBeenCalledExactlyOnceWith(
      'program-1', { trainerId: trainer.id },
    );
  });

  it('hides missing or foreign programs from a trainer', async () => {
    repository.findProgramById.mockResolvedValue(null);
    await expect(service.findOne('foreign-program', trainer))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to look up a program for a non-trainer', async () => {
    await expect(service.findOne('program-1', athlete))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findProgramById).not.toHaveBeenCalled();
  });

  it('archives an owned program with an atomic status predicate', async () => {
    const archived = { ...program, status: 'ARCHIVED' };
    repository.updateProgram.mockResolvedValue(archived);
    await expect(service.archive('program-1', trainer)).resolves.toBe(archived);
    expect(repository.updateProgram).toHaveBeenCalledExactlyOnceWith({
      id: 'program-1',
      trainerId: trainer.id,
      status: { not: 'ARCHIVED' },
    }, { status: 'ARCHIVED' });
  });

  it('rejects a second archive before any update', async () => {
    repository.findProgramById.mockResolvedValue({ ...program, status: 'ARCHIVED' });
    await expect(service.archive('program-1', trainer))
      .rejects.toBeInstanceOf(ConflictException);
    expect(repository.updateProgram).not.toHaveBeenCalled();
  });

  it('maps an archived-during-read P2025 race to conflict', async () => {
    repository.updateProgram.mockRejectedValue(prismaError('P2025'));
    await expect(service.archive('program-1', trainer))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('does not suppress an unexpected archive failure', async () => {
    const failure = new Error('Transaction unavailable');
    repository.updateProgram.mockRejectedValue(failure);
    await expect(service.archive('program-1', trainer)).rejects.toBe(failure);
  });

  it('never archives a foreign program', async () => {
    repository.findProgramById.mockResolvedValue(null);
    await expect(service.archive('foreign-program', trainer))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(repository.updateProgram).not.toHaveBeenCalled();
  });

  it('checks trainer privileges before archiving', async () => {
    await expect(service.archive('program-1', athlete))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.updateProgram).not.toHaveBeenCalled();
  });
});
