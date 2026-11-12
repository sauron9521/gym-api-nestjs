import { TrainingProgramAssignmentRepository } from '../repositories/training-program-assignment.repository.js';
import {
  trainingProgramAssignmentHistoricalSelect,
  trainingProgramAssignmentSelect,
  trainingProgramAssignmentSummarySelect,
} from '../selects/training-program-assignment.select.js';

describe('TrainingProgramAssignmentRepository privacy and completion', () => {
  const prisma = {
    $transaction: vi.fn(),
    trainingProgramAssignment: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };
  const trainerWhere = { version: { program: { trainerId: 'trainer-1' } } };
  const activeHistorical = {
    id: 'assignment-active',
    trainerAthlete: { status: 'ACTIVE' },
    status: 'ACTIVE',
  };
  const endedHistorical = {
    id: 'assignment-ended',
    trainerAthlete: { status: 'TERMINATED' },
    status: 'CANCELLED',
  };
  let repository: TrainingProgramAssignmentRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    repository = new TrainingProgramAssignmentRepository(prisma as never);
  });

  it('rechecks active relationships before returning sensitive trainer assignment details', async () => {
    const activeDetails = { id: 'assignment-active', workouts: [{ id: 'workout-1' }] };
    prisma.$transaction.mockResolvedValue([
      [endedHistorical, activeHistorical], 5,
    ]);
    prisma.trainingProgramAssignment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([activeDetails]);

    const result = await repository.findManyAssignmentsForTrainer({
      where: trainerWhere, skip: 2, take: 2,
    });

    expect(prisma.trainingProgramAssignment.findMany).toHaveBeenNthCalledWith(1, {
      where: trainerWhere, skip: 2, take: 2,
      orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
      select: trainingProgramAssignmentHistoricalSelect,
    });
    expect(prisma.trainingProgramAssignment.count)
      .toHaveBeenCalledExactlyOnceWith({ where: trainerWhere });
    expect(prisma.trainingProgramAssignment.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        AND: [
          trainerWhere,
          {
            id: { in: ['assignment-active'] },
            trainerAthlete: { is: { status: 'ACTIVE' } },
          },
        ],
      },
      select: trainingProgramAssignmentSelect,
    });
    expect(result).toEqual({
      data: [endedHistorical, activeDetails],
      meta: { total: 5, skip: 2, take: 2, totalPages: 3 },
    });
  });

  it('keeps historical projection when relationship ends between the two reads', async () => {
    prisma.$transaction.mockResolvedValue([[activeHistorical], 1]);
    prisma.trainingProgramAssignment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await repository.findManyAssignmentsForTrainer({
      where: trainerWhere, skip: 0, take: 20,
    });
    expect(result.data).toEqual([activeHistorical]);
    expect(prisma.trainingProgramAssignment.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.trainingProgramAssignment.findMany.mock.calls[1]?.[0]?.where)
      .toEqual({
        AND: [
          trainerWhere,
          {
            id: { in: ['assignment-active'] },
            trainerAthlete: { is: { status: 'ACTIVE' } },
          },
        ],
      });
  });

  it('skips sensitive detail queries if all trainer relationships are ended', async () => {
    prisma.$transaction.mockResolvedValue([[endedHistorical], 1]);
    const result = await repository.findManyAssignmentsForTrainer({
      where: trainerWhere, skip: 0, take: 10,
    });
    expect(result.data).toEqual([endedHistorical]);
    expect(result.meta.totalPages).toBe(1);
    expect(prisma.trainingProgramAssignment.findMany).toHaveBeenCalledTimes(1);
  });

  it('requests compact active assignment details when trainer view is summary', async () => {
    const activeSummary = { id: 'assignment-active' };
    prisma.$transaction.mockResolvedValue([[activeHistorical], 1]);
    prisma.trainingProgramAssignment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([activeSummary]);

    const result = await repository.findManyAssignmentsForTrainer({
      where: trainerWhere, skip: 0, take: 20, view: 'summary',
      orderBy: [{ id: 'asc' }],
    });

    expect(prisma.trainingProgramAssignment.findMany).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        orderBy: [{ id: 'asc' }],
        select: trainingProgramAssignmentHistoricalSelect,
      }),
    );
    expect(prisma.trainingProgramAssignment.findMany).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ select: trainingProgramAssignmentSummarySelect }),
    );
    expect(result.data).toEqual([activeSummary]);
  });

  it('preserves the original historical page order even when the detail query changes order', async () => {
    const first = { id: 'assignment-a', trainerAthlete: { status: 'ACTIVE' } };
    const second = { id: 'assignment-b', trainerAthlete: { status: 'ACTIVE' } };
    prisma.$transaction.mockResolvedValue([[first, endedHistorical, second], 3]);
    prisma.trainingProgramAssignment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'assignment-b', workouts: ['b'] },
        { id: 'assignment-a', workouts: ['a'] },
      ]);
    const result = await repository.findManyAssignmentsForTrainer({
      where: trainerWhere, skip: 0, take: 3,
    });
    expect(result.data).toEqual([
      { id: 'assignment-a', workouts: ['a'] },
      endedHistorical,
      { id: 'assignment-b', workouts: ['b'] },
    ]);
  });

  it('returns an empty historical page without loading active details', async () => {
    prisma.$transaction.mockResolvedValue([[], 0]);
    const result = await repository.findManyAssignmentsForTrainer({
      where: trainerWhere, skip: 0, take: 10,
    });
    expect(result).toEqual({
      data: [], meta: { total: 0, skip: 0, take: 10, totalPages: 0 },
    });
    expect(prisma.trainingProgramAssignment.findMany).toHaveBeenCalledTimes(1);
  });

  it('restricts individual historical details to non-active relationships', async () => {
    const historical = { id: 'assignment-ended', status: 'CANCELLED' };
    prisma.trainingProgramAssignment.findFirst.mockResolvedValue(historical);
    const result = await repository.findHistoricalAssignmentDetailsById(
      'assignment-ended', trainerWhere,
    );
    expect(result).toBe(historical);
    expect(prisma.trainingProgramAssignment.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: {
        AND: [
          { id: 'assignment-ended' },
          trainerWhere,
          { trainerAthlete: { is: { status: { not: 'ACTIVE' } } } },
        ],
      },
      select: trainingProgramAssignmentHistoricalSelect,
    });
  });

  it('passes custom assignment ordering and preserves zero-page metadata', async () => {
    prisma.$transaction.mockResolvedValue([[], 0]);
    const result = await repository.findManyAssignments({
      where: { athleteId: 'athlete-1' },
      skip: 0, take: 25, orderBy: [{ id: 'asc' }],
    });
    expect(result.meta.totalPages).toBe(0);
    expect(prisma.trainingProgramAssignment.findMany).toHaveBeenCalledWith({
      where: { athleteId: 'athlete-1' },
      skip: 0, take: 25,
      orderBy: [{ id: 'asc' }],
      select: trainingProgramAssignmentSelect,
    });
  });

  describe('completeAssignmentIfNoUnfinishedWorkouts', () => {
    const input = {
      assignmentId: 'assignment-1',
      athleteId: 'athlete-1',
      completedAt: new Date('2026-11-12T12:00:00.000Z'),
    };
    const tx = {
      $queryRaw: vi.fn(),
      workout: { count: vi.fn() },
      trainingProgramAssignment: { update: vi.fn() },
    };

    beforeEach(() => {
      vi.resetAllMocks();
      prisma.$transaction.mockImplementation(async (callback) => callback(tx));
      tx.$queryRaw.mockResolvedValue([{ id: input.assignmentId }]);
    });

    it('does not inspect workouts if there is no active assignment for the athlete', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(repository.completeAssignmentIfNoUnfinishedWorkouts(input))
        .resolves.toEqual({ status: 'NOT_ACTIVE' });
      const sql = (tx.$queryRaw.mock.calls[0]![0] as readonly string[]).join('?');
      expect(sql).toContain('FROM "training_program_assignments"');
      expect(sql).toContain('FOR UPDATE');
      expect(sql).toContain('"status" = \'ACTIVE\'');
      expect(tx.workout.count).not.toHaveBeenCalled();
      expect(tx.trainingProgramAssignment.update).not.toHaveBeenCalled();
    });

    it('rejects active assignments that still contain planned or in-progress workouts', async () => {
      tx.workout.count.mockResolvedValue(2);
      await expect(repository.completeAssignmentIfNoUnfinishedWorkouts(input))
        .resolves.toEqual({ status: 'HAS_UNFINISHED_WORKOUTS', unfinishedCount: 2 });
      expect(tx.workout.count).toHaveBeenCalledExactlyOnceWith({
        where: {
          programAssignmentId: input.assignmentId,
          status: { in: ['PLANNED', 'IN_PROGRESS'] },
        },
      });
      expect(tx.trainingProgramAssignment.update).not.toHaveBeenCalled();
    });

    it('atomically completes an active assignment after checking unfinished workouts', async () => {
      const assignment = { id: input.assignmentId, status: 'COMPLETED' };
      tx.workout.count.mockResolvedValue(0);
      tx.trainingProgramAssignment.update.mockResolvedValue(assignment);
      await expect(repository.completeAssignmentIfNoUnfinishedWorkouts(input))
        .resolves.toEqual({ status: 'COMPLETED', assignment });
      expect(tx.trainingProgramAssignment.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: input.assignmentId, status: 'ACTIVE' },
        data: { status: 'COMPLETED', completedAt: input.completedAt },
        select: trainingProgramAssignmentSelect,
      });
      expect(tx.$queryRaw.mock.invocationCallOrder[0])
        .toBeLessThan(tx.workout.count.mock.invocationCallOrder[0]!);
      expect(tx.workout.count.mock.invocationCallOrder[0])
        .toBeLessThan(tx.trainingProgramAssignment.update.mock.invocationCallOrder[0]!);
    });

    it('propagates a failed conditional update so the transaction can roll back', async () => {
      tx.workout.count.mockResolvedValue(0);
      const failure = new Error('conditional update failed');
      tx.trainingProgramAssignment.update.mockRejectedValue(failure);
      await expect(repository.completeAssignmentIfNoUnfinishedWorkouts(input))
        .rejects.toBe(failure);
    });
  });

  describe('createAssignmentForActiveRelationship lock checks', () => {
    const input = {
      programId: 'program-1',
      versionId: 'version-1',
      trainerAthleteId: 'relationship-1',
      trainerId: 'trainer-1',
      athleteId: 'athlete-1',
    };
    const tx = {
      trainingProgramVersion: { findFirst: vi.fn() },
      $queryRaw: vi.fn(),
      trainingProgramAssignment: { create: vi.fn() },
    };

    beforeEach(() => {
      vi.resetAllMocks();
      prisma.$transaction.mockImplementation(async (callback) => callback(tx));
      tx.trainingProgramVersion.findFirst.mockResolvedValue({
        workouts: [{ exercises: [] }],
      });
    });

    it('rejects a version invalidated after locking the trainer relationship', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([{ id: input.trainerAthleteId }])
        .mockResolvedValueOnce([]);
      await expect(repository.createAssignmentForActiveRelationship(input))
        .resolves.toBeNull();
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
      expect(tx.trainingProgramAssignment.create).not.toHaveBeenCalled();
    });

    it('rejects stale or duplicate relationship lock rows', async () => {
      tx.$queryRaw.mockResolvedValue([{ id: input.trainerAthleteId }, { id: 'bad' }]);
      await expect(repository.createAssignmentForActiveRelationship(input))
        .resolves.toBeNull();
      expect(tx.$queryRaw).toHaveBeenCalledOnce();
    });

    it('allows an unarchived global exercise and locks it before the relationship', async () => {
      tx.trainingProgramVersion.findFirst.mockResolvedValue({
        workouts: [{ exercises: [{ exerciseId: 'global-1' }] }],
      });
      tx.$queryRaw
        .mockResolvedValueOnce([
          { id: 'global-1', source: 'GLOBAL', createdById: null, isArchived: false },
        ])
        .mockResolvedValueOnce([{ id: input.trainerAthleteId }])
        .mockResolvedValueOnce([{ id: input.versionId }])
        .mockResolvedValueOnce([{ id: input.programId }]);
      const assignment = { id: 'assignment-1' };
      tx.trainingProgramAssignment.create.mockResolvedValue(assignment);

      await expect(repository.createAssignmentForActiveRelationship(input))
        .resolves.toBe(assignment);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
      const sourceLockSql = (tx.$queryRaw.mock.calls[0]![0] as readonly string[]).join('?');
      expect(sourceLockSql).toContain('FROM "exercises"');
      expect(sourceLockSql).toContain('FOR SHARE');
      expect(tx.$queryRaw.mock.invocationCallOrder[0])
        .toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[1]!);
      expect(tx.trainingProgramAssignment.create).toHaveBeenCalledWith({
        data: {
          version: { connect: { id: input.versionId } },
          trainerAthlete: { connect: { id: input.trainerAthleteId } },
          athlete: { connect: { id: input.athleteId } },
          assignedBy: { connect: { id: input.trainerId } },
        },
        select: trainingProgramAssignmentSelect,
      });
    });

    it('does not create an assignment if the exercise lock query throws', async () => {
      tx.trainingProgramVersion.findFirst.mockResolvedValue({
        workouts: [{ exercises: [{ exerciseId: 'global-1' }] }],
      });
      const failure = new Error('database disconnected');
      tx.$queryRaw.mockRejectedValue(failure);
      await expect(repository.createAssignmentForActiveRelationship(input))
        .rejects.toBe(failure);
      expect(tx.trainingProgramAssignment.create).not.toHaveBeenCalled();
    });
  });
});
