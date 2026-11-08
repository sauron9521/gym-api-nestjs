import { TrainingProgramVersionRepository } from '../repositories/training-program-version.repository.js';
import { trainingProgramVersionSelect } from '../selects/training-program-version.select.js';

describe('TrainingProgramVersionRepository', () => {
  const models = {
    $transaction: vi.fn(),

    trainingProgram: {
      findFirst: vi.fn(),
    },

    trainingProgramVersion: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  let repository: TrainingProgramVersionRepository;

  beforeEach(() => {
    vi.resetAllMocks();

    repository = new TrainingProgramVersionRepository(models as never);
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

  describe('createDraftFromLatestPublished', () => {
    it('copies workouts, exercises and sets into a new draft', async () => {
      const source = {
        id: 'version-2',
        version: 2,
        title: 'Strength Program',
        description: 'Progressive overload',
        durationWeeks: 6,
        workouts: [
          {
            id: 'workout-old',
            weekNumber: 1,
            dayNumber: 1,
            title: 'Upper Body',
            notes: 'Heavy day',
            exercises: [
              {
                id: 'exercise-old',
                exerciseId: 'exercise-1',
                exerciseNameSnapshot: 'Bench Press',
                exerciseTypeSnapshot: 'STRENGTH',
                sortOrder: 0,
                notes: null,
                sets: [
                  {
                    id: 'set-old',
                    setNumber: 1,
                    setType: 'WORKING',
                    plannedReps: 8,
                    plannedWeightKg: 80,
                    plannedDurationSeconds: null,
                    plannedDistanceMeters: null,
                    restSeconds: 120,
                    targetRpe: 8,
                    targetRir: null,
                    notes: null,
                  },
                ],
              },
            ],
          },
        ],
      };

      const draft = {
        id: 'version-3',
        version: 3,
        status: 'DRAFT',
      };

      const tx = {
        trainingProgram: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'program-1',
          }),
        },
        trainingProgramVersion: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(source),
          create: vi.fn().mockResolvedValue(draft),
        },
      };

      models.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );

      const result =
        await repository.createDraftFromLatestPublished('program-1');

      expect(tx.trainingProgram.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'program-1',
          status: { not: 'ARCHIVED' },
        },
        select: { id: true },
      });

      expect(tx.trainingProgramVersion.findFirst).toHaveBeenNthCalledWith(2, {
        where: {
          programId: 'program-1',
          status: 'PUBLISHED',
        },
        orderBy: { version: 'desc' },
        select: trainingProgramVersionSelect,
      });

      expect(tx.trainingProgramVersion.create).toHaveBeenCalledWith({
        data: {
          program: {
            connect: { id: 'program-1' },
          },
          version: 3,
          title: 'Strength Program',
          description: 'Progressive overload',
          durationWeeks: 6,
          status: 'DRAFT',
          workouts: {
            create: [
              {
                weekNumber: 1,
                dayNumber: 1,
                title: 'Upper Body',
                notes: 'Heavy day',
                exercises: {
                  create: [
                    {
                      exercise: {
                        connect: { id: 'exercise-1' },
                      },
                      exerciseNameSnapshot: 'Bench Press',
                      exerciseTypeSnapshot: 'STRENGTH',
                      sortOrder: 0,
                      notes: null,
                      sets: {
                        create: [
                          {
                            setNumber: 1,
                            setType: 'WORKING',
                            plannedReps: 8,
                            plannedWeightKg: 80,
                            plannedDurationSeconds: null,
                            plannedDistanceMeters: null,
                            restSeconds: 120,
                            targetRpe: 8,
                            targetRir: null,
                            notes: null,
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        select: trainingProgramVersionSelect,
      });

      expect(result).toEqual(draft);
    });

    it('returns null when the program does not exist or is archived', async () => {
      const tx = {
        trainingProgram: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        trainingProgramVersion: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
      };

      models.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );

      const result =
        await repository.createDraftFromLatestPublished('program-1');

      expect(tx.trainingProgram.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'program-1',
          status: { not: 'ARCHIVED' },
        },
        select: { id: true },
      });

      expect(result).toBeNull();

      expect(tx.trainingProgramVersion.findFirst).not.toHaveBeenCalled();

      expect(tx.trainingProgramVersion.create).not.toHaveBeenCalled();
    });

    it('returns null when a draft version already exists', async () => {
      const tx = {
        trainingProgram: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'program-1',
          }),
        },
        trainingProgramVersion: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'existing-draft',
            version: 3,
            status: 'DRAFT',
          }),
          create: vi.fn(),
        },
      };

      models.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );

      const result =
        await repository.createDraftFromLatestPublished('program-1');

      expect(tx.trainingProgramVersion.findFirst).toHaveBeenCalledTimes(1);

      expect(tx.trainingProgramVersion.findFirst).toHaveBeenCalledWith({
        where: {
          programId: 'program-1',
          status: 'DRAFT',
        },
        select: { id: true },
      });

      expect(result).toBeNull();

      expect(tx.trainingProgramVersion.create).not.toHaveBeenCalled();
    });

    it('returns null when no published version exists', async () => {
      const tx = {
        trainingProgram: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'program-1',
          }),
        },
        trainingProgramVersion: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce(null) // No existing draft
            .mockResolvedValueOnce(null), // No published version
          create: vi.fn(),
        },
      };

      models.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );

      const result =
        await repository.createDraftFromLatestPublished('program-1');

      expect(tx.trainingProgramVersion.findFirst).toHaveBeenCalledTimes(2);

      expect(tx.trainingProgramVersion.findFirst).toHaveBeenNthCalledWith(1, {
        where: {
          programId: 'program-1',
          status: 'DRAFT',
        },
        select: { id: true },
      });

      expect(tx.trainingProgramVersion.findFirst).toHaveBeenNthCalledWith(2, {
        where: {
          programId: 'program-1',
          status: 'PUBLISHED',
        },
        orderBy: { version: 'desc' },
        select: trainingProgramVersionSelect,
      });

      expect(tx.trainingProgramVersion.create).not.toHaveBeenCalled();

      expect(result).toBeNull();
    });
  });

  describe('publishVersion', () => {
    const validDraft = {
      id: 'version-1',
      programId: 'program-1',
      status: 'DRAFT',
      durationWeeks: 4,
      workouts: [
        { weekNumber: 1, exercises: [{ sets: [{ id: 'set-1' }] }] },
      ],
    };

    it('validates a locked draft before publishing', async () => {
      const publishedVersion = { ...validDraft, status: 'PUBLISHED' };
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'version-1' }]),
        trainingProgramVersion: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn()
            .mockResolvedValueOnce(validDraft)
            .mockResolvedValueOnce(publishedVersion),
        },
        trainingProgram: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };

      models.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );

      const result = await repository.publishVersion('program-1', 'version-1');

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.trainingProgramVersion.findUnique).toHaveBeenCalledTimes(2);
      expect(tx.trainingProgramVersion.updateMany).toHaveBeenCalledWith({
        where: { id: 'version-1', programId: 'program-1', status: 'DRAFT' },
        data: { status: 'PUBLISHED', publishedAt: expect.any(Date) },
      });
      expect(tx.trainingProgram.updateMany).toHaveBeenCalledWith({
        where: { id: 'program-1', status: { not: 'ARCHIVED' } },
        data: { status: 'PUBLISHED' },
      });
      expect(result).toEqual(publishedVersion);
    });

    it('returns null when the version is no longer a draft', async () => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        trainingProgramVersion: { findUnique: vi.fn(), updateMany: vi.fn() },
        trainingProgram: { updateMany: vi.fn() },
      };
      models.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );
      expect(await repository.publishVersion('program-1', 'version-1'))
        .toBeNull();
      expect(tx.trainingProgramVersion.findUnique).not.toHaveBeenCalled();
      expect(tx.trainingProgramVersion.updateMany).not.toHaveBeenCalled();
    });

    it('rejects invalid current draft without changing its status', async () => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'version-1' }]),
        trainingProgramVersion: {
          findUnique: vi.fn().mockResolvedValue({ ...validDraft, workouts: [] }),
          updateMany: vi.fn(),
        },
        trainingProgram: { updateMany: vi.fn() },
      };
      models.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );
      await expect(repository.publishVersion('program-1', 'version-1'))
        .rejects.toThrow('A program must contain at least one workout');
      expect(tx.trainingProgramVersion.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a workout beyond the declared duration', async () => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'version-1' }]),
        trainingProgramVersion: {
          findUnique: vi.fn().mockResolvedValue({
            ...validDraft,
            durationWeeks: 2,
            workouts: [{ weekNumber: 3, exercises: [{ sets: [{}] }] }],
          }),
          updateMany: vi.fn(),
        },
        trainingProgram: { updateMany: vi.fn() },
      };
      models.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );
      await expect(repository.publishVersion('program-1', 'version-1'))
        .rejects.toThrow('A workout week cannot exceed the program duration');
      expect(tx.trainingProgramVersion.updateMany).not.toHaveBeenCalled();
    });

    it('rolls back publication when the program was archived', async () => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'version-1' }]),
        trainingProgramVersion: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue(validDraft),
        },
        trainingProgram: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      };
      models.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );
      expect(await repository.publishVersion('program-1', 'version-1'))
        .toBeNull();
      expect(tx.trainingProgramVersion.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.trainingProgram.updateMany).toHaveBeenCalledTimes(1);
    });

    it('propagates unexpected transaction errors', async () => {
      const databaseError = new Error('Database connection lost');
      models.$transaction.mockRejectedValue(databaseError);
      await expect(repository.publishVersion('program-1', 'version-1'))
        .rejects.toBe(databaseError);
    });
  });

  describe('durationWeeks updates', () => {
    it('rejects shrinking below an existing workout week under a row lock', async () => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'version-1' }]),
        trainingProgramWorkout: {
          findFirst: vi.fn().mockResolvedValue({ weekNumber: 5 }),
        },
        trainingProgramVersion: { update: vi.fn() },
      };
      models.$transaction.mockImplementation(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      );
      await expect(
        repository.updateVersion(
          { id: 'version-1', programId: 'program-1', status: 'DRAFT' },
          { durationWeeks: 4 },
        ),
      ).rejects.toThrow('A workout week cannot exceed the program duration');
      expect(tx.trainingProgramVersion.update).not.toHaveBeenCalled();
    });
  });
});
