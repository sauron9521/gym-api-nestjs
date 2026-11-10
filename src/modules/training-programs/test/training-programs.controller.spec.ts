import { TrainingProgramsController } from '../training-programs.controller.js';
import { TrainingProgramsService } from '../services/training-programs.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

describe('TrainingProgramsController', () => {
  const service = {
    create: vi.fn(),
    findMany: vi.fn(),
    findOne: vi.fn(),
    archive: vi.fn(),
  };

  let controller: TrainingProgramsController;

  const actor: TrainingProgramActor = {
    id: 'trainer-1',
    role: 'TRAINER',
  };

  beforeEach(() => {
    vi.resetAllMocks();

    controller = new TrainingProgramsController(
      service as unknown as TrainingProgramsService,
    );
  });

  it('should create a program', async () => {
    const body = {
      title: 'Beginner program',
      durationWeeks: 4,
    };

    service.create.mockResolvedValue({ id: 'program-1' });

    await expect(controller.create(actor, body)).resolves.toEqual({
      id: 'program-1',
    });

    expect(service.create).toHaveBeenCalledWith(actor, body);
  });

  it('should find programs', async () => {
    const query = { page: 1, limit: 20 };

    service.findMany.mockResolvedValue({ data: [], meta: {} });

    await controller.findMany(actor, query);

    expect(service.findMany).toHaveBeenCalledWith(actor, query);
  });
  it('should return the requested program for the current actor', async () => {
    const result = { id: 'program-1', title: 'Program 1' };
    service.findOne.mockResolvedValue(result);

    await expect(controller.findOne('program-1', actor)).resolves.toBe(result);
    expect(service.findOne).toHaveBeenCalledWith('program-1', actor);
  });

  it('should archive a program using the current actor', async () => {
    const result = { id: 'program-1', status: 'ARCHIVED' };
    service.archive.mockResolvedValue(result);

    await expect(controller.archive('program-1', actor)).resolves.toBe(result);
    expect(service.archive).toHaveBeenCalledWith('program-1', actor);
  });

});
