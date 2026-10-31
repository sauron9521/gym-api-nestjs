import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type {
  ExerciseSource,
  ExerciseVisibility,
} from '../../generated/prisma/client.js';
import { Prisma } from '../../generated/prisma/client.js';

import { ExercisesRepository } from './exercises.repository.js';

import type {
  CreateExerciseInput,
  ExerciseAccessContext,
  ExerciseActor,
  ExerciseListQuery,
  UpdateExerciseInput,
} from './types/exercise.types.js';

@Injectable()
export class ExercisesService {
  constructor(private readonly exercisesRepository: ExercisesRepository) {}

  // CREATE
  async create(actor: ExerciseActor, input: CreateExerciseInput) {
    const source = this.resolveSource(actor);

    const visibility = this.resolveVisibility(source, input.visibility);

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

    const where = this.buildVisibilityWhere(actor, access);

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
    const where = this.buildVisibilityWhere(actor, access);

    const exercise = await this.exercisesRepository.findById(id, {
      AND: [where, { isArchived: false }],
    });

    if (!exercise) {
      throw new NotFoundException('Exercise not found');
    }

    return exercise;
  }

  // UPDATE
  async update(id: string, actor: ExerciseActor, input: UpdateExerciseInput) {
    const exercise = await this.exercisesRepository.findById(id, {
      isArchived: false,
    });

    if (!exercise) {
      throw new NotFoundException('Exercise not found');
    }

    this.assertCanManage(actor, exercise);

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

    const where = this.getManagementWhere(actor, exercise);

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
    const exercise = await this.exercisesRepository.findById(id, {
      isArchived: false,
    });

    if (!exercise) {
      throw new NotFoundException('Exercise not found');
    }

    this.assertCanManage(actor, exercise);

    try {
      return await this.exercisesRepository.archive(
        this.getManagementWhere(actor, exercise),
      );
    } catch (error) {
      if (this.isRecordNotFound(error)) {
        throw new NotFoundException('Exercise not found');
      }

      throw error;
    }
  }

  // ACCESS RULES
  private buildVisibilityWhere(
    actor: ExerciseActor | null,
    access: ExerciseAccessContext,
  ): Prisma.ExerciseWhereInput {
    if (!actor) {
      return { source: 'GLOBAL' };
    }

    if (actor.role === 'ADMIN') {
      return {};
    }

    if (actor.role === 'ATHLETE') {
      return {
        OR: [
          { source: 'GLOBAL' },

          {
            source: 'ATHLETE_CUSTOM',
            createdById: actor.id,
          },

          {
            source: 'TRAINER_CUSTOM',
            createdById: {
              in: access.activeTrainerIds,
            },
          },
        ],
      };
    }

    if (actor.role === 'TRAINER') {
      return {
        OR: [
          { source: 'GLOBAL' },

          {
            source: 'TRAINER_CUSTOM',
            createdById: actor.id,
          },

          {
            source: 'ATHLETE_CUSTOM',
            visibility: 'SELECTED_TRAINERS',
            createdById: {
              in: access.activeAthleteIds,
            },
            trainerAccesses: {
              some: {
                trainerId: actor.id,
                revokedAt: null,
              },
            },
          },
        ],
      };
    }

    throw new ForbiddenException();
  }

  private resolveSource(actor: ExerciseActor): ExerciseSource {
    switch (actor.role) {
      case 'ADMIN':
        return 'GLOBAL';

      case 'TRAINER':
        return 'TRAINER_CUSTOM';

      case 'ATHLETE':
        return 'ATHLETE_CUSTOM';

      default:
        throw new ForbiddenException('You cannot create exercises');
    }
  }

  private resolveVisibility(
    source: ExerciseSource,
    requested?: ExerciseVisibility,
  ): ExerciseVisibility | null {
    if (source !== 'ATHLETE_CUSTOM') {
      if (requested !== undefined) {
        throw new BadRequestException(
          'Visibility is only available for athlete custom exercises',
        );
      }

      return null;
    }

    return requested ?? 'PRIVATE';
  }

  private assertCanManage(
    actor: ExerciseActor,
    exercise: {
      source: ExerciseSource;
      createdById: string | null;
    },
  ): void {
    if (actor.role === 'ADMIN' && exercise.source === 'GLOBAL') {
      return;
    }

    if (exercise.source !== 'GLOBAL' && exercise.createdById === actor.id) {
      return;
    }

    throw new ForbiddenException('You cannot modify this exercise');
  }

  private getManagementWhere(
    actor: ExerciseActor,
    exercise: {
      id: string;
      source: ExerciseSource;
      createdById: string | null;
    },
  ): Prisma.ExerciseWhereUniqueInput {
    if (actor.role === 'ADMIN' && exercise.source === 'GLOBAL') {
      return {
        id: exercise.id,
        source: 'GLOBAL',
        isArchived: false,
      };
    }

    return {
      id: exercise.id,
      createdById: actor.id,
      source: exercise.source,
      isArchived: false,
    };
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
