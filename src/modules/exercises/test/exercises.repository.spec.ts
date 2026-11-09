import { PrismaService } from '../../../infra/database/index.js';
import { Prisma } from '../../../infra/database/generated/prisma/client.js';

import {
  ExercisesRepository,
  exerciseSelect,
} from '../exercises.repository.js';

describe('ExercisesRepository', () => {
  let repository: ExercisesRepository;

  const prisma = {
    $transaction: vi.fn(),

    exercise: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },

    muscleGroup: {
      findMany: vi.fn(),
    },

    equipment: {
      findMany: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();

    repository = new ExercisesRepository(prisma as unknown as PrismaService);
  });

  describe('findMany', () => {
    it('should return exercises with pagination metadata', async () => {
      const exercises = [
        { id: 'exercise-1', name: 'Bench Press' },
        { id: 'exercise-2', name: 'Squat' },
      ];

      prisma.exercise.findMany.mockResolvedValue(exercises);
      prisma.exercise.count.mockResolvedValue(22);

      prisma.$transaction.mockResolvedValue([exercises, 22]);

      const params = {
        where: { source: 'GLOBAL' } as Prisma.ExerciseWhereInput,
        skip: 10,
        take: 5,
      };

      const result = await repository.findMany(params);

      expect(prisma.exercise.findMany).toHaveBeenCalledWith({
        where: params.where,
        skip: 10,
        take: 5,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: exerciseSelect,
      });

      expect(prisma.exercise.count).toHaveBeenCalledWith({
        where: params.where,
      });

      expect(prisma.$transaction).toHaveBeenCalledOnce();

      expect(result).toEqual({
        data: exercises,
        meta: {
          total: 22,
          skip: 10,
          take: 5,
          totalPages: 5,
        },
      });
    });

    it('should use custom ordering when provided', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await repository.findMany({
        where: { isArchived: false },
        skip: 0,
        take: 10,
        orderBy: [{ createdAt: 'desc' }],
      });

      expect(prisma.exercise.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }],
        }),
      );
    });

    it('should return empty results when no exercises exist', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      const result = await repository.findMany({
        where: { source: 'GLOBAL' },
        skip: 0,
        take: 10,
      });

      expect(result).toEqual({
        data: [],
        meta: {
          total: 0,
          skip: 0,
          take: 10,
          totalPages: 0,
        },
      });
    });
  });

  describe('findById', () => {
    it('should return an exercise by ID with additional conditions', async () => {
      const exercise = {
        id: 'exercise-1',
        name: 'Bench Press',
      };

      prisma.exercise.findFirst.mockResolvedValue(exercise);

      const result = await repository.findById('exercise-1', {
        isArchived: false,
        source: 'GLOBAL',
      });

      expect(prisma.exercise.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [
            { id: 'exercise-1' },
            {
              isArchived: false,
              source: 'GLOBAL',
            },
          ],
        },
        select: exerciseSelect,
      });

      expect(result).toEqual(exercise);
    });

    it('should return null when exercise does not exist', async () => {
      prisma.exercise.findFirst.mockResolvedValue(null);

      const result = await repository.findById('missing-id', {
        isArchived: false,
      });

      expect(result).toBeNull();
    });
  });

  describe('findBySlug', () => {
    it('should return an exercise by slug', async () => {
      const exercise = {
        id: 'exercise-1',
        slug: 'barbell-bench-press',
        name: 'Barbell Bench Press',
      };

      prisma.exercise.findFirst.mockResolvedValue(exercise);

      const result = await repository.findBySlug('barbell-bench-press', {
        source: 'GLOBAL',
      });

      expect(prisma.exercise.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [{ slug: 'barbell-bench-press' }, { source: 'GLOBAL' }],
        },
        select: exerciseSelect,
      });

      expect(result).toEqual(exercise);
    });

    it('should return null when slug does not exist', async () => {
      prisma.exercise.findFirst.mockResolvedValue(null);

      const result = await repository.findBySlug('unknown-exercise', {
        isArchived: false,
      });

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create an exercise with selected fields', async () => {
      const data = {
        name: 'Bench Press',
        source: 'ATHLETE_CUSTOM',
        createdBy: {
          connect: { id: 'athlete-1' },
        },
      } satisfies Prisma.ExerciseCreateInput;

      const exercise = {
        id: 'exercise-1',
        name: 'Bench Press',
      };

      prisma.exercise.create.mockResolvedValue(exercise);

      const result = await repository.create(data);

      expect(prisma.exercise.create).toHaveBeenCalledWith({
        data,
        select: exerciseSelect,
      });

      expect(result).toEqual(exercise);
    });

    it('should propagate database errors', async () => {
      const error = new Error('Database connection failed');

      prisma.exercise.create.mockRejectedValue(error);

      await expect(
        repository.create({
          name: 'Bench Press',
          source: 'ATHLETE_CUSTOM',
          createdBy: {
            connect: { id: 'athlete-1' },
          },
        }),
      ).rejects.toBe(error);
    });
  });

  describe('update', () => {
    it('should update an exercise using ownership conditions', async () => {
      const where = {
        id: 'exercise-1',
        createdById: 'athlete-1',
        isArchived: false,
      };

      const data = {
        name: 'Updated Bench Press',
      };

      const exercise = {
        id: 'exercise-1',
        name: 'Updated Bench Press',
      };

      prisma.exercise.update.mockResolvedValue(exercise);

      const result = await repository.update(where, data);

      expect(prisma.exercise.update).toHaveBeenCalledWith({
        where,
        data,
        select: exerciseSelect,
      });

      expect(result).toEqual(exercise);
    });

    it('should propagate database errors', async () => {
      const error = new Error('Update failed');

      prisma.exercise.update.mockRejectedValue(error);

      await expect(
        repository.update(
          {
            id: 'exercise-1',
            createdById: 'athlete-1',
          },
          { name: 'Updated name' },
        ),
      ).rejects.toBe(error);
    });
  });

  describe('archive', () => {
    it('should archive an exercise', async () => {
      const where = {
        id: 'exercise-1',
        createdById: 'athlete-1',
        isArchived: false,
      };

      const archivedExercise = {
        id: 'exercise-1',
        isArchived: true,
      };

      prisma.exercise.update.mockResolvedValue(archivedExercise);

      const result = await repository.archive(where);

      expect(prisma.exercise.update).toHaveBeenCalledWith({
        where,
        data: {
          isArchived: true,
        },
        select: {
          id: true,
          isArchived: true,
          updatedAt: true,
        },
      });

      expect(result).toEqual(archivedExercise);
    });
  });

  describe('findMuscleGroupsBySlugs', () => {
    it('should return muscle groups by slugs', async () => {
      const muscleGroups = [
        { id: 'muscle-1', name: 'Chest', slug: 'chest' },
        { id: 'muscle-2', name: 'Triceps', slug: 'triceps' },
      ];

      prisma.muscleGroup.findMany.mockResolvedValue(muscleGroups);

      const result = await repository.findMuscleGroupsBySlugs([
        'chest',
        'triceps',
      ]);

      expect(prisma.muscleGroup.findMany).toHaveBeenCalledWith({
        where: {
          slug: {
            in: ['chest', 'triceps'],
          },
        },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      });

      expect(result).toEqual(muscleGroups);
    });

    it('should return an empty array when no groups exist', async () => {
      prisma.muscleGroup.findMany.mockResolvedValue([]);

      const result = await repository.findMuscleGroupsBySlugs(['unknown']);

      expect(result).toEqual([]);
    });
  });

  describe('findEquipmentBySlugs', () => {
    it('should return equipment by slugs', async () => {
      const equipment = [
        { id: 'equipment-1', name: 'Barbell', slug: 'barbell' },
        { id: 'equipment-2', name: 'Bench', slug: 'bench' },
      ];

      prisma.equipment.findMany.mockResolvedValue(equipment);

      const result = await repository.findEquipmentBySlugs([
        'barbell',
        'bench',
      ]);

      expect(prisma.equipment.findMany).toHaveBeenCalledWith({
        where: {
          slug: {
            in: ['barbell', 'bench'],
          },
        },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      });

      expect(result).toEqual(equipment);
    });

    it('should return an empty array when no equipment exists', async () => {
      prisma.equipment.findMany.mockResolvedValue([]);

      const result = await repository.findEquipmentBySlugs(['unknown']);

      expect(result).toEqual([]);
    });
  });
});
