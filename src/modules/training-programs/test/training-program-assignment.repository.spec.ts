import { TrainingProgramAssignmentRepository } from '../repositories/training-program-assignment.repository.js';

import {
  trainingProgramAssignmentSelect,
  trainingProgramAssignmentDetailsSelect,
  trainingProgramAssignmentSummarySelect,
} from '../selects/training-program-assignment.select.js';

describe('TrainingProgramAssignmentRepository', () => {
  const models = {
    $transaction: vi.fn(),

    trainingProgramAssignment: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  let repository: TrainingProgramAssignmentRepository;

  beforeEach(() => {
    vi.resetAllMocks();

    repository = new TrainingProgramAssignmentRepository(models as never);
  });

  describe('assignments', () => {
    it('should return assignments with pagination metadata', async () => {
      const data = [{ id: 'assignment-1' }];

      models.$transaction.mockResolvedValue([data, 1]);

      const result = await repository.findManyAssignments({
        where: {
          athleteId: 'athlete-1',
        },
        skip: 0,
        take: 20,
      });

      expect(models.trainingProgramAssignment.findMany).toHaveBeenCalledWith({
        where: { athleteId: 'athlete-1' },
        skip: 0,
        take: 20,
        orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
        select: trainingProgramAssignmentSelect,
      });

      expect(models.trainingProgramAssignment.count).toHaveBeenCalledWith({
        where: { athleteId: 'athlete-1' },
      });

      expect(result).toEqual({
        data,
        meta: {
          total: 1,
          skip: 0,
          take: 20,
          totalPages: 1,
        },
      });
    });

    it('uses the compact view without fetching workout instances', async () => {
      models.$transaction.mockResolvedValue([[{ id: 'assignment-1' }], 1]);

      await repository.findManyAssignments({
        where: { athleteId: 'athlete-1' },
        skip: 0,
        take: 20,
        view: 'summary',
      });

      expect(models.trainingProgramAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: trainingProgramAssignmentSummarySelect,
        }),
      );
      expect(trainingProgramAssignmentSummarySelect.workouts).toBe(false);
    });

    it('should find an assignment by ID and additional conditions', async () => {
      const assignment = { id: 'assignment-1' };

      models.trainingProgramAssignment.findFirst.mockResolvedValue(assignment);

      const result = await repository.findAssignmentById('assignment-1', {
        athleteId: 'athlete-1',
      });

      expect(models.trainingProgramAssignment.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [{ id: 'assignment-1' }, { athleteId: 'athlete-1' }],
        },
        select: trainingProgramAssignmentSelect,
      });

      expect(result).toEqual(assignment);
    });

    it('should find assignment details by ID and additional conditions', async () => {
      const assignment = {
        id: 'assignment-1',
        athleteId: 'athlete-1',
        version: {
          id: 'version-1',
          workouts: [
            {
              id: 'program-workout-1',
              exercises: [
                {
                  id: 'program-exercise-1',
                  exerciseNameSnapshot: 'Bench Press',
                  sets: [
                    {
                      id: 'program-set-1',
                      setNumber: 1,
                      plannedReps: 10,
                      plannedWeightKg: 60,
                      targetRpe: 8,
                    },
                  ],
                },
              ],
            },
          ],
        },
      };

      models.trainingProgramAssignment.findFirst.mockResolvedValue(assignment);

      const result = await repository.findAssignmentDetailsById(
        'assignment-1',
        {
          athleteId: 'athlete-1',
        },
      );

      expect(models.trainingProgramAssignment.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [{ id: 'assignment-1' }, { athleteId: 'athlete-1' }],
        },
        select: trainingProgramAssignmentDetailsSelect,
      });

      expect(result).toEqual(assignment);
    });

    it('should find active assignments for a trainer-athlete relationship', async () => {
      const assignments = [{ id: 'assignment-1' }];

      models.trainingProgramAssignment.findMany.mockResolvedValue(assignments);

      const result =
        await repository.findActiveAssignmentByRelationship('relationship-1');

      expect(models.trainingProgramAssignment.findMany).toHaveBeenCalledWith({
        where: {
          trainerAthleteId: 'relationship-1',
          status: 'ACTIVE',
        },
        select: trainingProgramAssignmentSelect,
      });

      expect(result).toEqual(assignments);
    });

    const input = {
      programId: 'program-1',
      versionId: 'version-1',
      trainerAthleteId: 'relationship-1',
      trainerId: 'trainer-1',
      athleteId: 'athlete-1',
    };

    const source = { workouts: [{ exercises: [] as Array<{ exerciseId: string }> }] };

    it('rejects an inactive relationship after checking published source eligibility', async () => {
      const tx = {
        trainingProgramVersion: { findFirst: vi.fn().mockResolvedValue(source) },
        $queryRaw: vi.fn().mockResolvedValue([]),
        trainingProgramAssignment: { create: vi.fn() },
      };
      models.$transaction.mockImplementation(async (callback) => callback(tx));

      expect(await repository.createAssignmentForActiveRelationship(input))
        .toBeNull();
      expect(tx.trainingProgramVersion.findFirst).toHaveBeenCalledWith({
        where: {
          id: input.versionId,
          programId: input.programId,
          status: 'PUBLISHED',
        },
        select: {
          workouts: {
            select: { exercises: { select: { exerciseId: true } } },
          },
        },
      });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.trainingProgramAssignment.create).not.toHaveBeenCalled();
    });

    it('rejects a version that is not published or belongs to another program', async () => {
      const tx = {
        trainingProgramVersion: { findFirst: vi.fn().mockResolvedValue(null) },
        $queryRaw: vi.fn(),
        trainingProgramAssignment: { create: vi.fn() },
      };
      models.$transaction.mockImplementation(async (callback) => callback(tx));

      expect(await repository.createAssignmentForActiveRelationship(input))
        .toBeNull();
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.trainingProgramAssignment.create).not.toHaveBeenCalled();
    });

    it('rejects an archived or foreign program before insertion', async () => {
      const tx = {
        trainingProgramVersion: { findFirst: vi.fn().mockResolvedValue(source) },
        $queryRaw: vi.fn()
          .mockResolvedValueOnce([{ id: input.trainerAthleteId }])
          .mockResolvedValueOnce([{ id: input.versionId }])
          .mockResolvedValueOnce([]),
        trainingProgramAssignment: { create: vi.fn() },
      };
      models.$transaction.mockImplementation(async (callback) => callback(tx));

      expect(await repository.createAssignmentForActiveRelationship(input))
        .toBeNull();
      expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
      expect(tx.trainingProgramAssignment.create).not.toHaveBeenCalled();
    });

    it('creates a legacy published-version assignment after relationship, version and program locks', async () => {
      const assignment = { id: 'assignment-1' };
      const tx = {
        trainingProgramVersion: { findFirst: vi.fn().mockResolvedValue(source) },
        $queryRaw: vi.fn()
          .mockResolvedValueOnce([{ id: input.trainerAthleteId }])
          .mockResolvedValueOnce([{ id: input.versionId }])
          .mockResolvedValueOnce([{ id: input.programId }]),
        trainingProgramAssignment: {
          create: vi.fn().mockResolvedValue(assignment),
        },
      };
      models.$transaction.mockImplementation(async (callback) => callback(tx));

      const result = await repository.createAssignmentForActiveRelationship(input);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(3);

      const queries = tx.$queryRaw.mock.calls.map(([parts]) =>
        (parts as readonly string[]).join('?'),
      );
      expect(queries[0]).toContain('FOR UPDATE');
      expect(queries[1]).toContain('FOR SHARE');
      expect(queries[2]).toContain('FOR SHARE');
      expect(queries[1]).toContain('"status" = \'PUBLISHED\'');
      expect(queries[2]).toContain('"status" <> \'ARCHIVED\'');

      expect(tx.trainingProgramAssignment.create).toHaveBeenCalledWith({
        data: {
          version: { connect: { id: input.versionId } },
          trainerAthlete: { connect: { id: input.trainerAthleteId } },
          athlete: { connect: { id: input.athleteId } },
          assignedBy: { connect: { id: input.trainerId } },
        },
        select: trainingProgramAssignmentSelect,
      });
      expect(result).toEqual(assignment);
    });

    it.each([
      { name: 'archived GLOBAL', exercise: { id: 'exercise-1', source: 'GLOBAL', createdById: null, isArchived: true } },
      { name: 'foreign TRAINER_CUSTOM', exercise: { id: 'exercise-1', source: 'TRAINER_CUSTOM', createdById: 'other-trainer', isArchived: false } },
      { name: 'ATHLETE_CUSTOM', exercise: { id: 'exercise-1', source: 'ATHLETE_CUSTOM', createdById: input.athleteId, isArchived: false } },
    ])('does not assign a published program referencing $name', async ({ exercise }) => {
      const tx = {
        trainingProgramVersion: { findFirst: vi.fn().mockResolvedValue({
          workouts: [{ exercises: [{ exerciseId: 'exercise-1' }] }],
        }) },
        $queryRaw: vi.fn().mockResolvedValue([exercise]),
        trainingProgramAssignment: { create: vi.fn() },
      };
      models.$transaction.mockImplementation(async (callback) => callback(tx));

      await expect(repository.createAssignmentForActiveRelationship(input))
        .resolves.toBeNull();
      expect(tx.$queryRaw).toHaveBeenCalledOnce();
      expect(tx.trainingProgramAssignment.create).not.toHaveBeenCalled();
    });

    it('rejects a missing source row before acquiring a relationship lock', async () => {
      const tx = {
        trainingProgramVersion: { findFirst: vi.fn().mockResolvedValue({
          workouts: [{ exercises: [{ exerciseId: 'exercise-1' }] }],
        }) },
        $queryRaw: vi.fn().mockResolvedValue([]),
        trainingProgramAssignment: { create: vi.fn() },
      };
      models.$transaction.mockImplementation(async (callback) => callback(tx));
      await expect(repository.createAssignmentForActiveRelationship(input))
        .resolves.toBeNull();
      expect(tx.$queryRaw).toHaveBeenCalledOnce();
      expect(tx.trainingProgramAssignment.create).not.toHaveBeenCalled();
    });

    it('locks unique available sources before relationship, version and program', async () => {
      const assignment = { id: 'assignment-1' };
      const tx = {
        trainingProgramVersion: { findFirst: vi.fn().mockResolvedValue({
          workouts: [{ exercises: [{ exerciseId: 'exercise-1' }, { exerciseId: 'exercise-1' }] }],
        }) },
        $queryRaw: vi.fn()
          .mockResolvedValueOnce([
            { id: 'exercise-1', source: 'TRAINER_CUSTOM', createdById: input.trainerId, isArchived: false },
          ])
          .mockResolvedValueOnce([{ id: input.trainerAthleteId }])
          .mockResolvedValueOnce([{ id: input.versionId }])
          .mockResolvedValueOnce([{ id: input.programId }]),
        trainingProgramAssignment: { create: vi.fn().mockResolvedValue(assignment) },
      };
      models.$transaction.mockImplementation(async (callback) => callback(tx));

      const result = await repository.createAssignmentForActiveRelationship(input);
      expect(result).toEqual(assignment);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
      const queries = tx.$queryRaw.mock.calls.map(([parts]) =>
        (parts as readonly string[]).join('?'),
      );
      expect(queries[0]).toContain('FROM "exercises"');
      expect(queries[0]).toContain('FOR SHARE');
      expect(queries[1]).toContain('FROM "trainer_athletes"');
      expect(queries[1]).toContain('FOR UPDATE');
      expect(queries[2]).toContain('FROM "training_program_versions"');
      expect(queries[3]).toContain('FROM "training_programs"');
      expect(tx.$queryRaw.mock.invocationCallOrder[3]).toBeLessThan(
        tx.trainingProgramAssignment.create.mock.invocationCallOrder[0]!,
      );
    });

    it('should update an assignment', async () => {
      const updated = {
        id: 'assignment-1',
        status: 'COMPLETED',
      };

      models.trainingProgramAssignment.update.mockResolvedValue(updated);

      const result = await repository.updateAssignment(
        { id: 'assignment-1' },
        { status: 'COMPLETED', completedAt: new Date() },
      );

      expect(models.trainingProgramAssignment.update).toHaveBeenCalledWith({
        where: { id: 'assignment-1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          completedAt: expect.any(Date),
        }),
        select: trainingProgramAssignmentSelect,
      });

      expect(result).toEqual(updated);
    });
  });
});
