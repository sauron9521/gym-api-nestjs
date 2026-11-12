import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '#prisma/client';
import { TrainingProgramAssignmentService } from '../services/training-program-assignment.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

describe('TrainingProgramAssignmentService', () => {
  const repository = {
    createAssignmentForActiveRelationship: vi.fn(),
    findManyAssignments: vi.fn(),
    findManyAssignmentsForTrainer: vi.fn(),
    findAssignmentById: vi.fn(),
    findAssignmentDetailsById: vi.fn(),
    findHistoricalAssignmentDetailsById: vi.fn(),
    updateAssignment: vi.fn(),
    completeAssignmentIfNoUnfinishedWorkouts: vi.fn(),
  };
  const crud = { findOne: vi.fn() };
  const versions = { findVersion: vi.fn() };
  const access = { assertTrainer: vi.fn() };
  const trainerAthletes = { findOne: vi.fn() };
  const trainer: TrainingProgramActor = { id: 'trainer-1', role: 'TRAINER' };
  const athlete: TrainingProgramActor = { id: 'athlete-1', role: 'ATHLETE' };
  const admin: TrainingProgramActor = { id: 'admin-1', role: 'ADMIN' };
  const programId = 'program-1';
  const versionId = 'version-1';
  const assignmentId = 'assignment-1';
  const assignmentInput = { trainerAthleteId: 'relationship-1' };
  const relationship = {
    id: 'relationship-1',
    trainerId: trainer.id,
    athleteId: athlete.id,
    status: 'ACTIVE',
  };
  const activeAssignment = { id: assignmentId, status: 'ACTIVE' };
  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('Concurrent write', {
      code, clientVersion: '7.0.0',
    });
  let service: TrainingProgramAssignmentService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new TrainingProgramAssignmentService(
      repository as never,
      crud as never,
      versions as never,
      access as never,
      trainerAthletes as never,
    );
    access.assertTrainer.mockImplementation((actor: TrainingProgramActor) => {
      if (actor.role !== 'TRAINER') throw new ForbiddenException();
    });
    crud.findOne.mockResolvedValue({ id: programId, status: 'DRAFT' });
    versions.findVersion.mockResolvedValue({ id: versionId, status: 'PUBLISHED' });
    trainerAthletes.findOne.mockResolvedValue(relationship);
    repository.findAssignmentById.mockResolvedValue(activeAssignment);
  });

  it('creates an assignment only from a published owned program and active relationship', async () => {
    const assignment = { id: assignmentId };
    repository.createAssignmentForActiveRelationship.mockResolvedValue(assignment);
    await expect(service.assignVersionToAthlete(
      trainer, programId, versionId, assignmentInput,
    )).resolves.toBe(assignment);
    expect(access.assertTrainer).toHaveBeenCalledExactlyOnceWith(trainer);
    expect(crud.findOne).toHaveBeenCalledExactlyOnceWith(programId, trainer);
    expect(versions.findVersion)
      .toHaveBeenCalledExactlyOnceWith(programId, versionId, trainer);
    expect(trainerAthletes.findOne)
      .toHaveBeenCalledExactlyOnceWith(assignmentInput.trainerAthleteId, trainer);
    expect(repository.createAssignmentForActiveRelationship)
      .toHaveBeenCalledExactlyOnceWith({
        programId, versionId, trainerAthleteId: relationship.id,
        trainerId: trainer.id, athleteId: athlete.id,
      });
  });

  it('rejects a non-trainer before looking up resources', async () => {
    await expect(service.assignVersionToAthlete(
      athlete, programId, versionId, assignmentInput,
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(crud.findOne).not.toHaveBeenCalled();
    expect(repository.createAssignmentForActiveRelationship).not.toHaveBeenCalled();
  });

  it('rejects archived programs before requesting version details', async () => {
    crud.findOne.mockResolvedValue({ id: programId, status: 'ARCHIVED' });
    await expect(service.assignVersionToAthlete(
      trainer, programId, versionId, assignmentInput,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(versions.findVersion).not.toHaveBeenCalled();
  });

  it('rejects draft versions before looking up a relationship', async () => {
    versions.findVersion.mockResolvedValue({ id: versionId, status: 'DRAFT' });
    await expect(service.assignVersionToAthlete(
      trainer, programId, versionId, assignmentInput,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(trainerAthletes.findOne).not.toHaveBeenCalled();
  });

  it('rejects an athlete of a different trainer before writing', async () => {
    trainerAthletes.findOne.mockResolvedValue({
      ...relationship, trainerId: 'other-trainer',
    });
    await expect(service.assignVersionToAthlete(
      trainer, programId, versionId, assignmentInput,
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.createAssignmentForActiveRelationship).not.toHaveBeenCalled();
  });

  it('rejects inactive relationships before writing', async () => {
    trainerAthletes.findOne.mockResolvedValue({
      ...relationship, status: 'TERMINATED',
    });
    await expect(service.assignVersionToAthlete(
      trainer, programId, versionId, assignmentInput,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(repository.createAssignmentForActiveRelationship).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'P2002', expected: ConflictException },
    { code: 'P2025', expected: ConflictException },
    { code: 'P2003', expected: NotFoundException },
  ])('maps a concurrent assignment $code to $expected.name', async ({ code, expected }) => {
    repository.createAssignmentForActiveRelationship.mockRejectedValue(prismaError(code));
    await expect(service.assignVersionToAthlete(
      trainer, programId, versionId, assignmentInput,
    )).rejects.toBeInstanceOf(expected);
  });

  it('rejects an assignment invalidated by a repository-level lock', async () => {
    repository.createAssignmentForActiveRelationship.mockResolvedValue(null);
    await expect(service.assignVersionToAthlete(
      trainer, programId, versionId, assignmentInput,
    )).rejects.toBeInstanceOf(ConflictException);
  });

  it('preserves unexpected assignment write errors', async () => {
    const failure = new Error('Postgres connection lost');
    repository.createAssignmentForActiveRelationship.mockRejectedValue(failure);
    await expect(service.assignVersionToAthlete(
      trainer, programId, versionId, assignmentInput,
    )).rejects.toBe(failure);
  });

  it.each([
    { page: 0, limit: 10 },
    { page: 1.5, limit: 10 },
    { page: 1, limit: 0 },
    { page: 1, limit: 101 },
    { page: 1, limit: Number.NaN },
  ])('refuses invalid assignment pagination %j', async (query) => {
    await expect(service.findManyAssignments(trainer, query))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.findManyAssignments).not.toHaveBeenCalled();
    expect(repository.findManyAssignmentsForTrainer).not.toHaveBeenCalled();
  });

  it('refuses all assignment list access to administrators', async () => {
    await expect(service.findManyAssignments(admin, { page: 1, limit: 10 }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findManyAssignments).not.toHaveBeenCalled();
  });

  it('scopes trainer assignment lists to owned programs and uses privacy-aware repository', async () => {
    const result = { data: [], meta: { total: 0 } };
    repository.findManyAssignmentsForTrainer.mockResolvedValue(result);
    await expect(service.findManyAssignments(trainer, {
      page: 3, limit: 5, status: 'ACTIVE', view: 'summary',
    })).resolves.toBe(result);
    expect(repository.findManyAssignmentsForTrainer).toHaveBeenCalledExactlyOnceWith({
      where: {
        AND: [
          { version: { program: { trainerId: trainer.id } } },
          { status: 'ACTIVE' },
        ],
      },
      skip: 10, take: 5, view: 'summary',
    });
    expect(repository.findManyAssignments).not.toHaveBeenCalled();
  });

  it('scopes athlete assignment lists to themselves without a trainer join', async () => {
    const result = { data: [], meta: { total: 0 } };
    repository.findManyAssignments.mockResolvedValue(result);
    await expect(service.findManyAssignments(athlete, { page: 1, limit: 20 }))
      .resolves.toBe(result);
    expect(repository.findManyAssignments).toHaveBeenCalledExactlyOnceWith({
      where: { AND: [{ athleteId: athlete.id }] },
      skip: 0, take: 20,
    });
    expect(repository.findManyAssignmentsForTrainer).not.toHaveBeenCalled();
  });

  it('hides assignments outside the actor scope', async () => {
    repository.findAssignmentById.mockResolvedValue(null);
    await expect(service.findOneAssignment(assignmentId, trainer))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findAssignmentById).toHaveBeenCalledExactlyOnceWith(
      assignmentId, { version: { program: { trainerId: trainer.id } } },
    );
  });

  it('prevents administrators from looking up assignments', async () => {
    await expect(service.findOneAssignment(assignmentId, admin))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findAssignmentById).not.toHaveBeenCalled();
  });

  it('returns active relationship details to the trainer with a scoped status predicate', async () => {
    const details = { id: assignmentId, workouts: [{ id: 'workout-1' }] };
    repository.findAssignmentDetailsById.mockResolvedValue(details);
    await expect(service.findOneAssignmentDetails(assignmentId, trainer))
      .resolves.toBe(details);
    expect(repository.findAssignmentDetailsById).toHaveBeenCalledExactlyOnceWith(
      assignmentId, {
        AND: [
          { version: { program: { trainerId: trainer.id } } },
          { trainerAthlete: { is: { status: 'ACTIVE' } } },
        ],
      },
    );
    expect(repository.findHistoricalAssignmentDetailsById).not.toHaveBeenCalled();
  });

  it('falls back to a restricted historical projection if trainer access ended', async () => {
    repository.findAssignmentDetailsById.mockResolvedValue(null);
    const historical = { id: assignmentId, status: 'CANCELLED' };
    repository.findHistoricalAssignmentDetailsById.mockResolvedValue(historical);
    await expect(service.findOneAssignmentDetails(assignmentId, trainer))
      .resolves.toBe(historical);
    expect(repository.findHistoricalAssignmentDetailsById).toHaveBeenCalledExactlyOnceWith(
      assignmentId, { version: { program: { trainerId: trainer.id } } },
    );
  });

  it('hides historical details when the trainer does not own the program', async () => {
    repository.findAssignmentDetailsById.mockResolvedValue(null);
    repository.findHistoricalAssignmentDetailsById.mockResolvedValue(null);
    await expect(service.findOneAssignmentDetails(assignmentId, trainer))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows an athlete to retrieve full details from their own history', async () => {
    const details = { id: assignmentId, workouts: [{ id: 'workout-1' }] };
    repository.findAssignmentDetailsById.mockResolvedValue(details);
    await expect(service.findOneAssignmentDetails(assignmentId, athlete))
      .resolves.toBe(details);
    expect(repository.findAssignmentDetailsById).toHaveBeenCalledExactlyOnceWith(
      assignmentId, { athleteId: athlete.id },
    );
    expect(repository.findHistoricalAssignmentDetailsById).not.toHaveBeenCalled();
  });

  it('hides another athlete assignment details', async () => {
    repository.findAssignmentDetailsById.mockResolvedValue(null);
    await expect(service.findOneAssignmentDetails(assignmentId, athlete))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('forbids trainer completion without querying the assignment', async () => {
    await expect(service.completeAssignment(assignmentId, trainer))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findAssignmentById).not.toHaveBeenCalled();
  });

  it('refuses completion of an already completed assignment', async () => {
    repository.findAssignmentById.mockResolvedValue({
      ...activeAssignment, status: 'COMPLETED',
    });
    await expect(service.completeAssignment(assignmentId, athlete))
      .rejects.toBeInstanceOf(ConflictException);
    expect(repository.completeAssignmentIfNoUnfinishedWorkouts).not.toHaveBeenCalled();
  });

  it('atomically completes an active assignment for its athlete', async () => {
    const completed = { id: assignmentId, status: 'COMPLETED' };
    repository.completeAssignmentIfNoUnfinishedWorkouts.mockResolvedValue({
      status: 'COMPLETED', assignment: completed,
    });
    await expect(service.completeAssignment(assignmentId, athlete))
      .resolves.toBe(completed);
    expect(repository.completeAssignmentIfNoUnfinishedWorkouts)
      .toHaveBeenCalledExactlyOnceWith({
        assignmentId, athleteId: athlete.id, completedAt: expect.any(Date),
      });
  });

  it('reports remaining unfinished workouts using the repository count', async () => {
    repository.completeAssignmentIfNoUnfinishedWorkouts.mockResolvedValue({
      status: 'HAS_UNFINISHED_WORKOUTS', unfinishedCount: 2,
    });
    await expect(service.completeAssignment(assignmentId, athlete))
      .rejects.toThrow('2 unfinished workout(s) remain');
  });

  it('maps a concurrent state change discovered during completion to conflict', async () => {
    repository.completeAssignmentIfNoUnfinishedWorkouts.mockResolvedValue({
      status: 'NOT_ACTIVE',
    });
    await expect(service.completeAssignment(assignmentId, athlete))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('does not turn unexpected completion errors into successful completion', async () => {
    const failure = new Error('Transaction rolled back');
    repository.completeAssignmentIfNoUnfinishedWorkouts.mockRejectedValue(failure);
    await expect(service.completeAssignment(assignmentId, athlete)).rejects.toBe(failure);
  });

  it('forbids athlete cancellation without loading the assignment', async () => {
    await expect(service.cancelAssignment(assignmentId, athlete))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findAssignmentById).not.toHaveBeenCalled();
  });

  it('refuses cancellation of an already ended assignment', async () => {
    repository.findAssignmentById.mockResolvedValue({
      ...activeAssignment, status: 'CANCELLED',
    });
    await expect(service.cancelAssignment(assignmentId, trainer))
      .rejects.toBeInstanceOf(ConflictException);
    expect(repository.updateAssignment).not.toHaveBeenCalled();
  });

  it('trims the cancellation reason and conditionally updates only an ACTIVE assignment', async () => {
    const cancelled = { id: assignmentId, status: 'CANCELLED' };
    repository.updateAssignment.mockResolvedValue(cancelled);
    await expect(service.cancelAssignment(assignmentId, trainer, {
      reason: '  Assigned new program  ',
    })).resolves.toBe(cancelled);
    expect(repository.updateAssignment).toHaveBeenCalledExactlyOnceWith({
      id: assignmentId, status: 'ACTIVE',
    }, {
      status: 'CANCELLED',
      endedAt: expect.any(Date),
      endedBy: { connect: { id: trainer.id } },
      endReason: 'Assigned new program',
    });
  });

  it.each([
    { reason: undefined },
    { reason: null },
    { reason: '   ' },
  ])('normalizes a missing or blank reason to null %j', async (input) => {
    await service.cancelAssignment(assignmentId, trainer, input);
    expect(repository.updateAssignment).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ endReason: null }),
    );
  });

  it('maps an already-ended concurrent cancellation to conflict', async () => {
    repository.updateAssignment.mockRejectedValue(prismaError('P2025'));
    await expect(service.cancelAssignment(assignmentId, trainer))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('preserves unexpected cancellation write errors for diagnostics', async () => {
    const failure = new Error('Database unavailable');
    repository.updateAssignment.mockRejectedValue(failure);
    await expect(service.cancelAssignment(assignmentId, trainer)).rejects.toBe(failure);
  });

  it('does not expose assignment completion to non-participant administrators', async () => {
    await expect(service.completeAssignment(assignmentId, admin))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findAssignmentById).not.toHaveBeenCalled();
  });
});
