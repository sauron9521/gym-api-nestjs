import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '#prisma/client';

import { ExercisesRepository } from '../repositories/exercises.repository.js';
import {
  assertCanManageExercise,
  buildExerciseManagementLookupWhere,
  buildExerciseVisibilityWhere,
  getExerciseManagementWhere,
  resolveExerciseSource,
  resolveExerciseVisibility,
} from '../policies/exercise-access.policy.js';

import type {
  CreateExerciseInput,
  ExerciseAccessContext,
  ExerciseActor,
  ExerciseListQuery,
  UpdateExerciseInput,
} from '../types/exercise.types.js';

@Injectable()
export class ExercisesService {
  constructor(private readonly exercisesRepository: ExercisesRepository) {}

  // CREATE
  async create(actor: ExerciseActor, input: CreateExerciseInput) {
    const source = resolveExerciseSource(actor);

    const visibility = resolveExerciseVisibility(source, input.visibility);

    await this.validateRelations(input.muscleGroups, input.equipment);

    const data = {
      name: input.name.trim(),
      description: input.description ?? null,
      instructions: input.instructions ?? null,
      exerciseType: input.exerciseType ?? 'STRENGTH',
      source,
      visibility,

      createdBy: {
        connect: { id: actor.id },
      },

      muscleGroups: {
        create: input.muscleGroups.map((item) => ({
          role: item.role,
          muscleGroup: {
            connect: { slug: item.slug },
          },
        })),
      },

      equipment: {
        create: input.equipment.map((slug) => ({
          equipment: {
            connect: { slug },
          },
        })),
      },
    } satisfies Prisma.ExerciseCreateInput;

    return this.exercisesRepository.create(data);
  }

  // FIND MANY
  async findMany(
    actor: ExerciseActor | null,
    query: ExerciseListQuery,
    access: ExerciseAccessContext,
  ) {
    this.validatePagination(query);

    const where = buildExerciseVisibilityWhere(actor, access);

    const filters: Prisma.ExerciseWhereInput[] = [where, { isArchived: false }];

    if (query.search?.trim()) {
      filters.push({
        name: {
          contains: query.search.trim(),
          mode: 'insensitive',
        },
      });
    }

    if (query.exerciseType) {
      filters.push({
        exerciseType: query.exerciseType,
      });
    }

    if (query.muscleGroup) {
      filters.push({
        muscleGroups: {
          some: {
            muscleGroup: {
              slug: query.muscleGroup,
            },
          },
        },
      });
    }

    if (query.equipment) {
      filters.push({
        equipment: {
          some: {
            equipment: {
              slug: query.equipment,
            },
          },
        },
      });
    }

    return this.exercisesRepository.findMany({
      where: { AND: filters },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  }

  // FIND ONE
  async findOne(
    id: string,
    actor: ExerciseActor | null,
    access: ExerciseAccessContext,
  ) {
    const where = buildExerciseVisibilityWhere(actor, access);

    const exercise = await this.exercisesRepository.findById(id, {
      AND: [where, { isArchived: false }],
    });

    if (!exercise) {
      throw new NotFoundException('Exercise not found');
    }

    return exercise;
  }

  // FIND EXERCISE AVAILABLE FOR TRAINING PROGRAM
  async findAvailableForTrainingProgram(id: string, actor: ExerciseActor) {
    if (actor.role !== 'TRAINER') {
      throw new ForbiddenException(
        'Only trainers can use exercises in training programs',
      );
    }

    const exercise = await this.exercisesRepository.findById(id, {
      isArchived: false,
      OR: [
        {
          source: 'GLOBAL',
        },
        {
          source: 'TRAINER_CUSTOM',
          createdById: actor.id,
        },
      ],
    });

    if (!exercise) {
      throw new NotFoundException('Exercise not found');
    }

    return exercise;
  }

  // UPDATE
  async update(id: string, actor: ExerciseActor, input: UpdateExerciseInput) {
    const exercise = await this.exercisesRepository.findById(
      id,
      buildExerciseManagementLookupWhere(actor),
    );

    if (!exercise) {
      throw new NotFoundException('Exercise not found');
    }

    assertCanManageExercise(actor, exercise);

    if (input.muscleGroups !== undefined || input.equipment !== undefined) {
      await this.validateRelations(input.muscleGroups, input.equipment);
    }

    const data: Prisma.ExerciseUpdateInput = {};

    if (input.name !== undefined) {
      data.name = input.name.trim();
    }

    if (input.description !== undefined) {
      data.description = input.description;
    }

    if (input.instructions !== undefined) {
      data.instructions = input.instructions;
    }

    if (input.exerciseType !== undefined) {
      data.exerciseType = input.exerciseType;
    }

    if (input.visibility !== undefined) {
      if (exercise.source !== 'ATHLETE_CUSTOM') {
        throw new BadRequestException(
          'Visibility can only be changed for athlete custom exercises',
        );
      }

      data.visibility = input.visibility;

      if (input.visibility === 'PRIVATE') {
        data.trainerAccesses = {
          updateMany: {
            where: { revokedAt: null },
            data: { revokedAt: new Date() },
          },
        };
      }
    }

    if (input.muscleGroups !== undefined) {
      data.muscleGroups = {
        deleteMany: {},
        create: input.muscleGroups.map((item) => ({
          role: item.role,
          muscleGroup: {
            connect: { slug: item.slug },
          },
        })),
      };
    }

    if (input.equipment !== undefined) {
      data.equipment = {
        deleteMany: {},
        create: input.equipment.map((slug) => ({
          equipment: {
            connect: { slug },
          },
        })),
      };
    }

    const where = getExerciseManagementWhere(actor, exercise);

    try {
      return await this.exercisesRepository.update(where, data);
    } catch (error) {
      if (this.isRecordNotFound(error)) {
        throw new NotFoundException('Exercise not found');
      }

      throw error;
    }
  }

  // ARCHIVE
  async archive(id: string, actor: ExerciseActor) {
    const exercise = await this.exercisesRepository.findById(
      id,
      buildExerciseManagementLookupWhere(actor),
    );

    if (!exercise) {
      throw new NotFoundException('Exercise not found');
    }

    assertCanManageExercise(actor, exercise);

    try {
      return await this.exercisesRepository.archive(
        getExerciseManagementWhere(actor, exercise),
      );
    } catch (error) {
      if (this.isRecordNotFound(error)) {
        throw new NotFoundException('Exercise not found');
      }

      throw error;
    }
  }

  // VALIDATION
  private async validateRelations(
    muscleGroups?: CreateExerciseInput['muscleGroups'],
    equipment?: string[],
  ): Promise<void> {
    if (muscleGroups !== undefined) {
      const slugs = muscleGroups.map((item) => item.slug);
      const uniqueSlugs = [...new Set(slugs)];

      if (slugs.length !== uniqueSlugs.length) {
        throw new BadRequestException(
          'Duplicate muscle groups are not allowed',
        );
      }

      if (!muscleGroups.some((item) => item.role === 'PRIMARY')) {
        throw new BadRequestException(
          'At least one primary muscle group is required',
        );
      }

      const found =
        await this.exercisesRepository.findMuscleGroupsBySlugs(uniqueSlugs);

      if (found.length !== uniqueSlugs.length) {
        throw new BadRequestException('One or more muscle groups do not exist');
      }
    }

    if (equipment !== undefined) {
      const uniqueSlugs = [...new Set(equipment)];

      if (equipment.length !== uniqueSlugs.length) {
        throw new BadRequestException('Duplicate equipment is not allowed');
      }

      const found =
        await this.exercisesRepository.findEquipmentBySlugs(uniqueSlugs);

      if (found.length !== uniqueSlugs.length) {
        throw new BadRequestException(
          'One or more equipment items do not exist',
        );
      }
    }
  }

  async findAvailableForWorkout(
    actor: ExerciseActor,
    exerciseIds: string[],
    access: ExerciseAccessContext,
  ) {
    const uniqueIds = [...new Set(exerciseIds)];

    const exercises = await this.exercisesRepository.findAvailableForWorkout(
      uniqueIds,
      {
        AND: [buildExerciseVisibilityWhere(actor, access), { isArchived: false }],
      },
    );

    if (exercises.length !== uniqueIds.length) {
      throw new BadRequestException('One or more exercises are not available');
    }

    return exercises;
  }

  private validatePagination(query: ExerciseListQuery): void {
    if (
      !Number.isInteger(query.page) ||
      query.page < 1 ||
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      throw new BadRequestException('Invalid pagination parameters');
    }
  }

  private isRecordNotFound(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    );
  }
}
