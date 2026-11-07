import { TrainingProgramCrudRepository } from '../repositories/training-program-crud.repository.js';
import { trainingProgramSelect } from '../selects/training-program.select.js';

describe('TrainingProgramCrudRepository', () => {
  const models = {
    $transaction: vi.fn(),

    trainingProgram: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  let repository: TrainingProgramCrudRepository;

  beforeEach(() => {
    vi.resetAllMocks();

    repository = new TrainingProgramCrudRepository(models as never);
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
});
