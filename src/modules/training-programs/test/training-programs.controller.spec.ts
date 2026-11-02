import { TrainingProgramsController } from '../training-programs.controller.js';
import { TrainingProgramsService } from '../training-programs.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

describe('TrainingProgramsController', () => {
  const service = {
    create: vi.fn(),
    findMany: vi.fn(),
    findOne: vi.fn(),
    archive: vi.fn(),
    findVersions: vi.fn(),
    findVersion: vi.fn(),
    createNextDraft: vi.fn(),
    updateDraftVersion: vi.fn(),
    publishVersion: vi.fn(),
    createWorkout: vi.fn(),
    updateWorkout: vi.fn(),
    deleteWorkout: vi.fn(),
    addExercise: vi.fn(),
    updateExercise: vi.fn(),
    removeExercise: vi.fn(),
    reorderExercises: vi.fn(),
    addSet: vi.fn(),
    updateSet: vi.fn(),
    removeSet: vi.fn(),
    reorderSets: vi.fn(),
    assignVersionToAthlete: vi.fn(),
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

  it('should assign a published version to an athlete', async () => {
    const body = {
      trainerAthleteId: 'relationship-1',
    };

    service.assignVersionToAthlete.mockResolvedValue({
      id: 'assignment-1',
      status: 'ACTIVE',
    });

    await controller.assignVersionToAthlete(
      'program-1',
      'version-1',
      actor,
      body,
    );

    expect(service.assignVersionToAthlete).toHaveBeenCalledWith(
      actor,
      'program-1',
      'version-1',
      body,
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

  it('should publish a version', async () => {
    service.publishVersion.mockResolvedValue({
      id: 'version-1',
      status: 'PUBLISHED',
    });

    await controller.publishVersion('program-1', 'version-1', actor);

    expect(service.publishVersion).toHaveBeenCalledWith(
      'program-1',
      'version-1',
      actor,
    );
  });

  it('should add an exercise', async () => {
    const body = {
      exerciseId: 'exercise-1',
      notes: 'Keep controlled tempo',
    };

    service.addExercise.mockResolvedValue({ id: 'program-exercise-1' });

    await controller.addExercise(
      'program-1',
      'version-1',
      'workout-1',
      actor,
      body,
    );

    expect(service.addExercise).toHaveBeenCalledWith(
      actor,
      'program-1',
      'version-1',
      'workout-1',
      body,
    );
  });

  it('should add a set', async () => {
    const body = {
      setType: 'WORKING' as const,
      plannedReps: 10,
      plannedWeightKg: 60,
    };

    service.addSet.mockResolvedValue({ id: 'set-1' });

    await controller.addSet(
      'program-1',
      'version-1',
      'workout-1',
      'exercise-1',
      actor,
      body,
    );

    expect(service.addSet).toHaveBeenCalledWith(
      actor,
      'program-1',
      'version-1',
      'workout-1',
      'exercise-1',
      body,
    );
  });
});
