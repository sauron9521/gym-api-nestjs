import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { ExercisesService } from '../services/exercises.service.js';
import { ExercisesRepository } from '../repositories/exercises.repository.js';

import type {
  CreateExerciseInput,
  ExerciseAccessContext,
  ExerciseActor,
} from '../types/exercise.types.js';

describe('ExercisesService', () => {
  let service: ExercisesService;

  const repository = {
    create: vi.fn(),
    findMany: vi.fn(),
    findById: vi.fn(),
    findBySlug: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    findMuscleGroupsBySlugs: vi.fn(),
    findEquipmentBySlugs: vi.fn(),
  };

  const athlete: ExerciseActor = {
    id: 'athlete-1',
    role: 'ATHLETE',
  };

  const trainer: ExerciseActor = {
    id: 'trainer-1',
    role: 'TRAINER',
  };

  const admin: ExerciseActor = {
    id: 'admin-1',
    role: 'ADMIN',
  };

  const access: ExerciseAccessContext = {
    activeTrainerIds: ['trainer-1'],
    activeAthleteIds: ['athlete-1'],
  };

  const input: CreateExerciseInput = {
    name: 'Bench Press',
    description: 'Barbell chest exercise',
    exerciseType: 'STRENGTH',
    muscleGroups: [
      {
        slug: 'chest',
        role: 'PRIMARY',
      },
      {
        slug: 'triceps',
        role: 'SECONDARY',
      },
    ],
    equipment: ['barbell', 'bench'],
  };

  const exercise = {
    id: 'exercise-1',
    name: 'Bench Press',
    source: 'ATHLETE_CUSTOM',
    visibility: 'PRIVATE',
    createdById: athlete.id,
    isArchived: false,
  };

  beforeEach(() => {
    vi.resetAllMocks();

    repository.findMuscleGroupsBySlugs.mockResolvedValue([
      { id: 'muscle-1', slug: 'chest' },
      { id: 'muscle-2', slug: 'triceps' },
    ]);

    repository.findEquipmentBySlugs.mockResolvedValue([
      { id: 'equipment-1', slug: 'barbell' },
      { id: 'equipment-2', slug: 'bench' },
    ]);

    service = new ExercisesService(
      repository as unknown as ExercisesRepository,
    );
  });

  describe('create', () => {
    it('should create an athlete custom exercise', async () => {
      repository.create.mockResolvedValue(exercise);

      const result = await service.create(athlete, input);

      expect(result).toEqual(exercise);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bench Press',
          source: 'ATHLETE_CUSTOM',
          visibility: 'PRIVATE',
          createdBy: {
            connect: { id: athlete.id },
          },
        }),
      );
    });

    it('should create a trainer custom exercise', async () => {
      repository.create.mockResolvedValue({
        ...exercise,
        source: 'TRAINER_CUSTOM',
        visibility: null,
        createdById: trainer.id,
      });

      await service.create(trainer, input);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'TRAINER_CUSTOM',
          visibility: null,
          createdBy: {
            connect: { id: trainer.id },
          },
        }),
      );
    });

    it('should create a global exercise by admin', async () => {
      repository.create.mockResolvedValue({
        ...exercise,
        source: 'GLOBAL',
        visibility: null,
        createdById: admin.id,
      });

      await service.create(admin, input);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'GLOBAL',
          visibility: null,
          createdBy: {
            connect: { id: admin.id },
          },
        }),
      );
    });

    it('should reject visibility for trainer exercises', async () => {
      await expect(
        service.create(trainer, {
          ...input,
          visibility: 'PRIVATE',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should reject duplicate muscle groups', async () => {
      await expect(
        service.create(athlete, {
          ...input,
          muscleGroups: [
            { slug: 'chest', role: 'PRIMARY' },
            { slug: 'chest', role: 'SECONDARY' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should require at least one primary muscle group', async () => {
      await expect(
        service.create(athlete, {
          ...input,
          muscleGroups: [{ slug: 'chest', role: 'SECONDARY' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject unknown muscle groups', async () => {
      repository.findMuscleGroupsBySlugs.mockResolvedValue([]);

      await expect(service.create(athlete, input)).rejects.toThrow(
        BadRequestException,
      );

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should reject unknown equipment', async () => {
      repository.findEquipmentBySlugs.mockResolvedValue([]);

      await expect(service.create(athlete, input)).rejects.toThrow(
        BadRequestException,
      );

      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('findMany', () => {
    it('should return exercises with pagination', async () => {
      const response = {
        data: [exercise],
        meta: {
          total: 1,
          skip: 0,
          take: 10,
          totalPages: 1,
        },
      };

      repository.findMany.mockResolvedValue(response);

      const result = await service.findMany(
        athlete,
        {
          page: 1,
          limit: 10,
        },
        access,
      );

      expect(result).toEqual(response);

      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
        }),
      );
    });

    it('should filter exercises by search and muscle group', async () => {
      repository.findMany.mockResolvedValue({
        data: [],
        meta: {},
      });

      await service.findMany(
        athlete,
        {
          page: 1,
          limit: 10,
          search: 'bench',
          muscleGroup: 'chest',
          equipment: 'barbell',
          exerciseType: 'STRENGTH',
        },
        access,
      );

      const call = repository.findMany.mock.calls[0][0];

      expect(call.where.AND).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: {
              contains: 'bench',
              mode: 'insensitive',
            },
          }),
          expect.objectContaining({
            exerciseType: 'STRENGTH',
          }),
          expect.objectContaining({
            muscleGroups: expect.any(Object),
          }),
          expect.objectContaining({
            equipment: expect.any(Object),
          }),
        ]),
      );
    });

    it('should show global exercises to guests', async () => {
      repository.findMany.mockResolvedValue({
        data: [],
        meta: {},
      });

      await service.findMany(
        null,
        { page: 1, limit: 10 },
        {
          activeTrainerIds: [],
          activeAthleteIds: [],
        },
      );

      const call = repository.findMany.mock.calls[0][0];

      expect(call.where).toEqual({
        AND: [{ source: 'GLOBAL' }, { isArchived: false }],
      });
    });

    it('should reject invalid pagination', async () => {
      await expect(
        service.findMany(
          athlete,
          {
            page: 0,
            limit: 10,
          },
          access,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(repository.findMany).not.toHaveBeenCalled();
    });

    it('should reject pagination limit above 100', async () => {
      await expect(
        service.findMany(
          athlete,
          {
            page: 1,
            limit: 101,
          },
          access,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('should return an accessible exercise', async () => {
      repository.findById.mockResolvedValue(exercise);

      const result = await service.findOne(exercise.id, athlete, access);

      expect(result).toEqual(exercise);
    });

    it('should throw NotFoundException when exercise is missing', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.findOne('missing-id', athlete, access),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not expose private exercises to guests', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.findOne('exercise-1', null, {
          activeTrainerIds: [],
          activeAthleteIds: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAvailableForTrainingProgram', () => {
    it('should allow global exercises', async () => {
      const globalExercise = {
        ...exercise,
        source: 'GLOBAL',
        visibility: null,
        createdById: null,
      };

      repository.findById.mockResolvedValue(globalExercise);

      const result = await service.findAvailableForTrainingProgram(
        'exercise-1',
        trainer,
      );

      expect(result).toEqual(globalExercise);

      expect(repository.findById).toHaveBeenCalledWith('exercise-1', {
        isArchived: false,
        OR: [
          { source: 'GLOBAL' },
          {
            source: 'TRAINER_CUSTOM',
            createdById: trainer.id,
          },
        ],
      });
    });

    it('should allow trainer-owned custom exercises', async () => {
      const trainerExercise = {
        ...exercise,
        source: 'TRAINER_CUSTOM',
        visibility: null,
        createdById: trainer.id,
      };

      repository.findById.mockResolvedValue(trainerExercise);

      const result = await service.findAvailableForTrainingProgram(
        'exercise-1',
        trainer,
      );

      expect(result).toEqual(trainerExercise);
    });

    it('should reject athlete custom exercises', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.findAvailableForTrainingProgram('exercise-1', trainer),
      ).rejects.toThrow(NotFoundException);

      expect(repository.findById).toHaveBeenCalledWith('exercise-1', {
        isArchived: false,
        OR: [
          { source: 'GLOBAL' },
          {
            source: 'TRAINER_CUSTOM',
            createdById: trainer.id,
          },
        ],
      });
    });

    it('should reject non-trainers', async () => {
      await expect(
        service.findAvailableForTrainingProgram('exercise-1', athlete),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('should reject missing exercises', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.findAvailableForTrainingProgram('missing-id', trainer),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should allow the owner to update their exercise', async () => {
      repository.findById.mockResolvedValue(exercise);
      repository.update.mockResolvedValue({
        ...exercise,
        name: 'Updated Bench Press',
      });

      await service.update(exercise.id, athlete, {
        name: 'Updated Bench Press',
      });

      expect(repository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: exercise.id,
          createdById: athlete.id,
          source: 'ATHLETE_CUSTOM',
          isArchived: false,
        }),
        expect.objectContaining({
          name: 'Updated Bench Press',
        }),
      );
    });

    it('hides foreign custom exercises during update before any write', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.update(exercise.id, athlete, { name: 'Changed name' }),
      ).rejects.toThrow(NotFoundException);

      expect(repository.findById).toHaveBeenCalledWith(exercise.id, {
        isArchived: false,
        OR: [
          { source: 'GLOBAL' },
          { source: { not: 'GLOBAL' }, createdById: athlete.id },
        ],
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('defensively maps a foreign custom exercise to 404 even if a repository mock returns it', async () => {
      repository.findById.mockResolvedValue({
        ...exercise,
        createdById: 'another-athlete',
      });
      await expect(
        service.update(exercise.id, athlete, { name: 'Changed name' }),
      ).rejects.toThrow(NotFoundException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('keeps 403 when a non-admin attempts to update a global exercise', async () => {
      repository.findById.mockResolvedValue({
        ...exercise,
        source: 'GLOBAL',
        createdById: null,
      });
      await expect(
        service.update(exercise.id, athlete, { name: 'Cannot update global' }),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should allow admin to update global exercises', async () => {
      repository.findById.mockResolvedValue({
        ...exercise,
        source: 'GLOBAL',
        createdById: null,
      });

      repository.update.mockResolvedValue({
        ...exercise,
        source: 'GLOBAL',
      });

      await service.update(exercise.id, admin, {
        name: 'Updated Global Exercise',
      });

      expect(repository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: exercise.id,
          source: 'GLOBAL',
          isArchived: false,
        }),
        expect.objectContaining({
          name: 'Updated Global Exercise',
        }),
      );
    });

    it('should revoke trainer access when visibility becomes private', async () => {
      repository.findById.mockResolvedValue(exercise);
      repository.update.mockResolvedValue({
        ...exercise,
        visibility: 'PRIVATE',
      });

      await service.update(exercise.id, athlete, { visibility: 'PRIVATE' });

      expect(repository.update).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          visibility: 'PRIVATE',
          trainerAccesses: {
            updateMany: {
              where: { revokedAt: null },
              data: expect.objectContaining({
                revokedAt: expect.any(Date),
              }),
            },
          },
        }),
      );
    });
  });

  describe('archive', () => {
    it('should allow the owner to archive their exercise', async () => {
      repository.findById.mockResolvedValue(exercise);

      repository.archive.mockResolvedValue({
        id: exercise.id,
        isArchived: true,
      });

      const result = await service.archive(exercise.id, athlete);

      expect(result).toEqual({
        id: exercise.id,
        isArchived: true,
      });

      expect(repository.archive).toHaveBeenCalledWith(
        expect.objectContaining({
          id: exercise.id,
          createdById: athlete.id,
          source: 'ATHLETE_CUSTOM',
          isArchived: false,
        }),
      );
    });

    it('hides foreign custom exercises during archive before any write', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.archive(exercise.id, athlete)).rejects.toThrow(
        NotFoundException,
      );

      expect(repository.findById).toHaveBeenCalledWith(exercise.id, {
        isArchived: false,
        OR: [
          { source: 'GLOBAL' },
          { source: { not: 'GLOBAL' }, createdById: athlete.id },
        ],
      });
      expect(repository.archive).not.toHaveBeenCalled();
    });

    it('defensively maps foreign custom archive attempts to 404', async () => {
      repository.findById.mockResolvedValue({
        ...exercise,
        createdById: 'another-athlete',
      });
      await expect(service.archive(exercise.id, athlete)).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.archive).not.toHaveBeenCalled();
    });

    it('keeps 403 when a non-admin attempts to archive a global exercise', async () => {
      repository.findById.mockResolvedValue({
        ...exercise,
        source: 'GLOBAL',
        createdById: null,
      });
      await expect(service.archive(exercise.id, athlete)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.archive).not.toHaveBeenCalled();
    });

    it('allows admin to archive global exercises', async () => {
      repository.findById.mockResolvedValue({
        ...exercise,
        source: 'GLOBAL',
        createdById: null,
      });
      repository.archive.mockResolvedValue({ id: exercise.id, isArchived: true });
      await expect(service.archive(exercise.id, admin)).resolves.toEqual({
        id: exercise.id,
        isArchived: true,
      });
      expect(repository.archive).toHaveBeenCalledWith({
        id: exercise.id,
        source: 'GLOBAL',
        isArchived: false,
      });
    });

    it('should throw NotFoundException when exercise is missing', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.archive('missing-id', athlete)).rejects.toThrow(
        NotFoundException,
      );

      expect(repository.archive).not.toHaveBeenCalled();
    });
  });
});
