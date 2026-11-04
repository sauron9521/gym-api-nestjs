import {
  trainingProgramAssignmentDetailsSelect,
  trainingProgramAssignmentSelect,
  trainingProgramSelect,
  TrainingProgramsRepository,
  trainingProgramVersionSelect,
} from '../training-programs.repository.js';

describe('TrainingProgramsRepository', () => {
  const models = {
    $transaction: vi.fn(),

    trainingProgram: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },

    trainingProgramVersion: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },

    trainingProgramAssignment: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  let repository: TrainingProgramsRepository;

  beforeEach(() => {
    vi.resetAllMocks();

    repository = new TrainingProgramsRepository(models as never);
  });

  describe('programs', () => {
    it('should return programs with pagination metadata', async () => {
      const data = [{ id: 'program-1' }];

      models.$transaction.mockResolvedValue([data, 1]);

      const result = await repository.findMany({
        where: { trainerId: 'trainer-1' },
        skip: 0,
        take: 10,
      });

      expect(models.trainingProgram.findMany).toHaveBeenCalledWith({
        where: { trainerId: 'trainer-1' },
        skip: 0,
        take: 10,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: trainingProgramSelect,
      });

      expect(models.trainingProgram.count).toHaveBeenCalledWith({
        where: { trainerId: 'trainer-1' },
      });

      expect(result).toEqual({
        data,
        meta: {
          total: 1,
          skip: 0,
          take: 10,
          totalPages: 1,
        },
      });
    });

    it('should find a program by ID and additional conditions', async () => {
      const program = { id: 'program-1' };

      models.trainingProgram.findFirst.mockResolvedValue(program);

      const result = await repository.findProgramById('program-1', {
        trainerId: 'trainer-1',
      });

      expect(models.trainingProgram.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [{ id: 'program-1' }, { trainerId: 'trainer-1' }],
        },
        select: trainingProgramSelect,
      });

      expect(result).toEqual(program);
    });

    it('should create a program', async () => {
      const data = {
        id: 'program-1',
        trainerId: 'trainer-1',
      };

      models.trainingProgram.create.mockResolvedValue(data);

      const result = await repository.createProgram({
        trainer: {
          connect: { id: 'trainer-1' },
        },
      });

      expect(models.trainingProgram.create).toHaveBeenCalledWith({
        data: {
          trainer: {
            connect: { id: 'trainer-1' },
          },
        },
        select: trainingProgramSelect,
      });

      expect(result).toEqual(data);
    });

    it('should update a program', async () => {
      const updated = {
        id: 'program-1',
        status: 'ARCHIVED',
      };

      models.trainingProgram.update.mockResolvedValue(updated);

      const result = await repository.updateProgram(
        { id: 'program-1' },
        { status: 'ARCHIVED' },
      );

      expect(models.trainingProgram.update).toHaveBeenCalledWith({
        where: { id: 'program-1' },
        data: { status: 'ARCHIVED' },
        select: trainingProgramSelect,
      });

      expect(result).toEqual(updated);
    });
  });

  describe('versions', () => {
    it('should return versions ordered by version number', async () => {
      const versions = [
        { id: 'version-2', version: 2 },
        { id: 'version-1', version: 1 },
      ];

      models.trainingProgramVersion.findMany.mockResolvedValue(versions);

      const result = await repository.findVersions('program-1');

      expect(models.trainingProgramVersion.findMany).toHaveBeenCalledWith({
        where: { programId: 'program-1' },
        orderBy: { version: 'desc' },
        select: expect.objectContaining({
          id: true,
          version: true,
          status: true,
        }),
      });

      expect(result).toEqual(versions);
    });

    it('should find a version by ID with additional conditions', async () => {
      const version = { id: 'version-1' };

      models.trainingProgramVersion.findFirst.mockResolvedValue(version);

      const result = await repository.findVersionById('version-1', {
        programId: 'program-1',
      });

      expect(models.trainingProgramVersion.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [{ id: 'version-1' }, { programId: 'program-1' }],
        },
        select: trainingProgramVersionSelect,
      });

      expect(result).toEqual(version);
    });

    it('should find a version by its program and version number', async () => {
      const version = { id: 'version-2', version: 2 };

      models.trainingProgramVersion.findUnique.mockResolvedValue(version);

      const result = await repository.findVersionByNumber('program-1', 2);

      expect(models.trainingProgramVersion.findUnique).toHaveBeenCalledWith({
        where: {
          programId_version: {
            programId: 'program-1',
            version: 2,
          },
        },
        select: trainingProgramVersionSelect,
      });

      expect(result).toEqual(version);
    });

    it('should find a draft version', async () => {
      const version = { id: 'version-1', status: 'DRAFT' };

      models.trainingProgramVersion.findFirst.mockResolvedValue(version);

      const result = await repository.findDraftVersion('program-1');

      expect(models.trainingProgramVersion.findFirst).toHaveBeenCalledWith({
        where: {
          programId: 'program-1',
          status: 'DRAFT',
        },
        select: trainingProgramVersionSelect,
      });

      expect(result).toEqual(version);
    });

    it('should create a version', async () => {
      const version = {
        id: 'version-1',
        version: 1,
      };

      models.trainingProgramVersion.create.mockResolvedValue(version);

      const result = await repository.createVersion({
        program: {
          connect: { id: 'program-1' },
        },
        version: 1,
        title: 'Beginner Program',
      });

      expect(models.trainingProgramVersion.create).toHaveBeenCalledWith({
        data: {
          program: {
            connect: { id: 'program-1' },
          },
          version: 1,
          title: 'Beginner Program',
        },
        select: trainingProgramVersionSelect,
      });

      expect(result).toEqual(version);
    });

    it('should update a version', async () => {
      const updated = {
        id: 'version-1',
        status: 'PUBLISHED',
      };

      models.trainingProgramVersion.update.mockResolvedValue(updated);

      const result = await repository.updateVersion(
        { id: 'version-1' },
        {
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      );

      expect(models.trainingProgramVersion.update).toHaveBeenCalledWith({
        where: { id: 'version-1' },
        data: expect.objectContaining({
          status: 'PUBLISHED',
          publishedAt: expect.any(Date),
        }),
        select: trainingProgramVersionSelect,
      });

      expect(result).toEqual(updated);
    });
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

    it('should not create an assignment when relationship is inactive', async () => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        trainingProgramAssignment: {
          create: vi.fn(),
        },
      };

      models.$transaction.mockImplementation(async (callback) => {
        return callback(tx);
      });

      const result = await repository.createAssignmentForActiveRelationship({
        trainerAthleteId: 'relationship-1',
        trainerId: 'trainer-1',
        athleteId: 'athlete-1',
        data: {
          version: {
            connect: { id: 'version-1' },
          },
          trainerAthlete: {
            connect: { id: 'relationship-1' },
          },
          athlete: {
            connect: { id: 'athlete-1' },
          },
          assignedBy: {
            connect: { id: 'trainer-1' },
          },
        },
      });

      expect(result).toBeNull();

      expect(tx.trainingProgramAssignment.create).not.toHaveBeenCalled();
    });

    it('should create an assignment for an active relationship', async () => {
      const assignment = {
        id: 'assignment-1',
      };

      const data = {
        version: {
          connect: { id: 'version-1' },
        },
        trainerAthlete: {
          connect: { id: 'relationship-1' },
        },
        athlete: {
          connect: { id: 'athlete-1' },
        },
        assignedBy: {
          connect: { id: 'trainer-1' },
        },
      };

      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([
          {
            id: 'relationship-1',
          },
        ]),
        trainingProgramAssignment: {
          create: vi.fn().mockResolvedValue(assignment),
        },
      };

      models.$transaction.mockImplementation(async (callback) => {
        return callback(tx);
      });

      const result = await repository.createAssignmentForActiveRelationship({
        trainerAthleteId: 'relationship-1',
        trainerId: 'trainer-1',
        athleteId: 'athlete-1',
        data,
      });

      expect(tx.$queryRaw).toHaveBeenCalled();

      expect(tx.trainingProgramAssignment.create).toHaveBeenCalledWith({
        data,
        select: trainingProgramAssignmentSelect,
      });

      expect(result).toEqual(assignment);
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
