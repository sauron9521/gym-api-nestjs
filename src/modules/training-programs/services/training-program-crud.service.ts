import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../../../infra/database/generated/prisma/client.js';

import { TrainingProgramCrudRepository } from '../repositories/training-program-crud.repository.js';
import { TrainingProgramAccessService } from './training-program-access.service.js';

import type {
  CreateTrainingProgramInput,
  TrainingProgramActor,
  TrainingProgramListQuery,
} from '../types/training-program.types.js';

@Injectable()
export class TrainingProgramCrudService {
  constructor(
    private readonly repository: TrainingProgramCrudRepository,
    private readonly accessService: TrainingProgramAccessService,
  ) {}

  async create(actor: TrainingProgramActor, input: CreateTrainingProgramInput) {
    this.accessService.assertTrainer(actor);

    try {
      return await this.repository.createProgramWithDraft({
        trainerId: actor.id,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        durationWeeks: input.durationWeeks ?? null,
      });
    } catch (error) {
      if (this.isPrismaError(error, 'P2003')) {
        throw new NotFoundException('Trainer not found');
      }

      throw error;
    }
  }

  async findMany(actor: TrainingProgramActor, query: TrainingProgramListQuery) {
    this.accessService.assertTrainer(actor);
    this.validatePagination(query);

    return this.repository.findMany({
      where: {
        trainerId: actor.id,
        ...(query.status ? { status: query.status } : {}),
      },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  }

  async findOne(id: string, actor: TrainingProgramActor) {
    this.accessService.assertTrainer(actor);

    const program = await this.repository.findProgramById(id, {
      trainerId: actor.id,
    });

    if (!program) {
      throw new NotFoundException('Training program not found');
    }

    return program;
  }

  async archive(id: string, actor: TrainingProgramActor) {
    const program = await this.findOne(id, actor);

    if (program.status === 'ARCHIVED') {
      throw new ConflictException('Program is already archived');
    }

    try {
      return await this.repository.updateProgram(
        {
          id,
          trainerId: actor.id,
          status: {
            not: 'ARCHIVED',
          },
        },
        {
          status: 'ARCHIVED',
        },
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException(
          'Program state has changed. Reload and try again.',
        );
      }

      throw error;
    }
  }

  private validatePagination(query: TrainingProgramListQuery): void {
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

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
