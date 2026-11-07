import { TrainingProgramVersionRepository } from '../repositories/training-program-version.repository.js';
import { trainingProgramVersionSelect } from '../selects/training-program-version.select.js';

describe('TrainingProgramVersionRepository', () => {
  const models = {
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
});
