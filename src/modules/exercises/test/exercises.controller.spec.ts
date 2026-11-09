import { Test, TestingModule } from '@nestjs/testing';

import { ExercisesController } from '../exercises.controller.js';
import { ExercisesService } from '../exercises.service.js';

import { TrainerAthletesService } from '#src/modules/trainer-athletes/services/trainer-athletes.service';

import type {
  ExerciseAccessContext,
  ExerciseActor,
} from '../types/exercise.types.js';
import type { CreateExerciseDto } from '../dto/create-exercise.dto.js';
import type { UpdateExerciseDto } from '../dto/update-exercise.dto.js';
import type { QueryExercisesDto } from '../dto/query-exercises.dto.js';

describe('ExercisesController', () => {
  let controller: ExercisesController;

  const exercisesService = {
    findMany: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
  };

  const trainerAthletesService = {
    getExerciseAccessContext: vi.fn(),
  };

  const athlete: ExerciseActor = {
    id: 'athlete-1',
    role: 'ATHLETE',
  };

  const access: ExerciseAccessContext = {
    activeTrainerIds: [],
    activeAthleteIds: [],
  };

  beforeEach(async () => {
    vi.resetAllMocks();

    trainerAthletesService.getExerciseAccessContext.mockResolvedValue(access);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExercisesController],
      providers: [
        {
          provide: ExercisesService,
          useValue: exercisesService,
        },
        {
          provide: TrainerAthletesService,
          useValue: trainerAthletesService,
        },
      ],
    }).compile();

    controller = module.get<ExercisesController>(ExercisesController);
  });

  describe('findMany', () => {
    it('should return exercises with query and access context', async () => {
      const query: QueryExercisesDto = {
        page: 1,
        limit: 20,
        search: 'bench',
      };

      const exercises = {
        data: [{ id: 'exercise-1', name: 'Bench Press' }],
        meta: {
          total: 1,
          skip: 0,
          take: 20,
          totalPages: 1,
        },
      };

      exercisesService.findMany.mockResolvedValue(exercises);

      const result = await controller.findMany(athlete, query);

      expect(exercisesService.findMany).toHaveBeenCalledWith(
        athlete,
        query,
        access,
      );

      expect(result).toEqual(exercises);
      expect(
        trainerAthletesService.getExerciseAccessContext,
      ).toHaveBeenCalledWith(athlete);
    });

    it('should support guest requests', async () => {
      exercisesService.findMany.mockResolvedValue({
        data: [],
        meta: {},
      });

      await controller.findMany(null, {
        page: 1,
        limit: 20,
      });

      expect(exercisesService.findMany).toHaveBeenCalledWith(
        null,
        { page: 1, limit: 20 },
        access,
      );
    });
  });

  describe('findOne', () => {
    it('should return an exercise by ID', async () => {
      const exercise = {
        id: 'exercise-1',
        name: 'Bench Press',
      };

      exercisesService.findOne.mockResolvedValue(exercise);

      const result = await controller.findOne('exercise-1', athlete);

      expect(exercisesService.findOne).toHaveBeenCalledWith(
        'exercise-1',
        athlete,
        access,
      );

      expect(result).toEqual(exercise);
    });

    it('should support guest requests', async () => {
      exercisesService.findOne.mockResolvedValue({
        id: 'exercise-1',
      });

      await controller.findOne('exercise-1', null);

      expect(exercisesService.findOne).toHaveBeenCalledWith(
        'exercise-1',
        null,
        access,
      );
      expect(
        trainerAthletesService.getExerciseAccessContext,
      ).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should pass authenticated user and body to service', async () => {
      const body: CreateExerciseDto = {
        name: 'Custom Bench Press',
        exerciseType: 'STRENGTH',
        muscleGroups: [
          {
            slug: 'chest',
            role: 'PRIMARY',
          },
        ],
        equipment: ['barbell', 'bench'],
      };

      const exercise = {
        id: 'exercise-1',
        name: body.name,
      };

      exercisesService.create.mockResolvedValue(exercise);

      const result = await controller.create(athlete, body);

      expect(exercisesService.create).toHaveBeenCalledWith(athlete, body);

      expect(result).toEqual(exercise);
    });

    it('should propagate service errors', async () => {
      const error = new Error('Exercise creation failed');

      exercisesService.create.mockRejectedValue(error);

      await expect(
        controller.create(athlete, {
          name: 'Custom Exercise',
          exerciseType: 'STRENGTH',
          muscleGroups: [{ slug: 'chest', role: 'PRIMARY' }],
          equipment: [],
        }),
      ).rejects.toBe(error);
    });
  });

  describe('update', () => {
    it('should pass exercise ID, user and body to service', async () => {
      const body: UpdateExerciseDto = {
        name: 'Updated Bench Press',
      };

      const exercise = {
        id: 'exercise-1',
        name: body.name,
      };

      exercisesService.update.mockResolvedValue(exercise);

      const result = await controller.update('exercise-1', athlete, body);

      expect(exercisesService.update).toHaveBeenCalledWith(
        'exercise-1',
        athlete,
        body,
      );

      expect(result).toEqual(exercise);
    });
  });

  describe('archive', () => {
    it('should archive an exercise', async () => {
      const response = {
        id: 'exercise-1',
        isArchived: true,
      };

      exercisesService.archive.mockResolvedValue(response);

      const result = await controller.archive('exercise-1', athlete);

      expect(exercisesService.archive).toHaveBeenCalledWith(
        'exercise-1',
        athlete,
      );

      expect(result).toEqual(response);
    });
  });
});
