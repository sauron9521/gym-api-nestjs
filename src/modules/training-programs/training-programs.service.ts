import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';

import { TrainingProgramsRepository } from './training-programs.repository.js';

import type {
  CreateTrainingProgramInput,
  TrainingProgramActor,
  TrainingProgramListQuery,
  UpdateTrainingProgramDraftInput,
} from './types/training-program.types.js';

@Injectable()
export class TrainingProgramsService {
  constructor(
    private readonly trainingProgramsRepository: TrainingProgramsRepository,
  ) {}

  // ===========================================================================
  // CREATE PROGRAM
  // ===========================================================================

  async create(actor: TrainingProgramActor, input: CreateTrainingProgramInput) {
    this.assertTrainer(actor);

    try {
      return await this.trainingProgramsRepository.createProgramWithDraft({
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

  // ===========================================================================
  // FIND MANY
  // ===========================================================================

  async findMany(actor: TrainingProgramActor, query: TrainingProgramListQuery) {
    this.assertTrainer(actor);
    this.validatePagination(query);

    return this.trainingProgramsRepository.findMany({
      where: {
        trainerId: actor.id,
        ...(query.status ? { status: query.status } : {}),
      },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  }

  // ===========================================================================
  // FIND ONE
  // ===========================================================================

  async findOne(id: string, actor: TrainingProgramActor) {
    this.assertTrainer(actor);

    const program = await this.trainingProgramsRepository.findProgramById(id, {
      trainerId: actor.id,
    });

    if (!program) {
      throw new NotFoundException('Training program not found');
    }

    return program;
  }

  // ===========================================================================
  // FIND VERSIONS
  // ===========================================================================

  async findVersions(programId: string, actor: TrainingProgramActor) {
    await this.findOne(programId, actor);

    return this.trainingProgramsRepository.findVersions(programId);
  }

  // ===========================================================================
  // FIND VERSION DETAILS
  // ===========================================================================

  async findVersion(
    programId: string,
    versionId: string,
    actor: TrainingProgramActor,
  ) {
    await this.findOne(programId, actor);

    const version = await this.trainingProgramsRepository.findVersionById(
      versionId,
      {
        programId,
      },
    );

    if (!version) {
      throw new NotFoundException('Training program version not found');
    }

    return version;
  }

  // ===========================================================================
  // CREATE NEXT DRAFT
  // ===========================================================================

  async createNextDraft(programId: string, actor: TrainingProgramActor) {
    const program = await this.findOne(programId, actor);

    if (program.status === 'ARCHIVED') {
      throw new ConflictException('An archived program cannot be edited');
    }

    const existingDraft =
      await this.trainingProgramsRepository.findDraftVersion(programId);

    if (existingDraft) {
      throw new ConflictException('This program already has a draft version');
    }

    try {
      const draft =
        await this.trainingProgramsRepository.createDraftFromLatestPublished(
          programId,
        );

      if (!draft) {
        throw new ConflictException(
          'No published version is available to create a new draft',
        );
      }

      return draft;
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException(
          'A draft version already exists or was created concurrently',
        );
      }

      throw error;
    }
  }

  // ===========================================================================
  // UPDATE DRAFT VERSION
  // ===========================================================================

  async updateDraftVersion(
    programId: string,
    versionId: string,
    actor: TrainingProgramActor,
    input: UpdateTrainingProgramDraftInput,
  ) {
    const program = await this.findOne(programId, actor);

    if (program.status === 'ARCHIVED') {
      throw new ConflictException('An archived program cannot be edited');
    }

    const version = await this.findVersion(programId, versionId, actor);

    if (version.status !== 'DRAFT') {
      throw new ConflictException('Published versions are immutable');
    }

    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one field must be provided');
    }

    const data: Prisma.TrainingProgramVersionUpdateInput = {};

    if (input.title !== undefined) {
      data.title = input.title.trim();
    }

    if (input.description !== undefined) {
      data.description = input.description?.trim() || null;
    }

    if (input.durationWeeks !== undefined) {
      data.durationWeeks = input.durationWeeks;
    }

    try {
      return await this.trainingProgramsRepository.updateVersion(
        {
          id: versionId,
          programId,
          status: 'DRAFT',
        },
        data,
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException(
          'Version state has changed. Reload and try again.',
        );
      }

      throw error;
    }
  }

  // ===========================================================================
  // PUBLISH VERSION
  // ===========================================================================

  async publishVersion(
    programId: string,
    versionId: string,
    actor: TrainingProgramActor,
  ) {
    const program = await this.findOne(programId, actor);

    if (program.status === 'ARCHIVED') {
      throw new ConflictException('An archived program cannot be published');
    }

    const version = await this.findVersion(programId, versionId, actor);

    if (version.status !== 'DRAFT') {
      throw new ConflictException('Only draft versions can be published');
    }

    this.assertPublishable(version);

    const published = await this.trainingProgramsRepository.publishVersion(
      programId,
      versionId,
    );

    if (!published) {
      throw new ConflictException(
        'Version state has changed. Reload and try again.',
      );
    }

    return published;
  }

  // ===========================================================================
  // ARCHIVE PROGRAM
  // ===========================================================================

  async archive(id: string, actor: TrainingProgramActor) {
    const program = await this.findOne(id, actor);

    if (program.status === 'ARCHIVED') {
      throw new ConflictException('Program is already archived');
    }

    try {
      return await this.trainingProgramsRepository.updateProgram(
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

  // ===========================================================================
  // VALIDATION
  // ===========================================================================

  private assertPublishable(version: {
    workouts: Array<{
      exercises: Array<{
        sets: unknown[];
      }>;
    }>;
  }): void {
    if (version.workouts.length === 0) {
      throw new BadRequestException(
        'A program must contain at least one workout',
      );
    }

    for (const workout of version.workouts) {
      if (workout.exercises.length === 0) {
        throw new BadRequestException(
          'Every program workout must contain at least one exercise',
        );
      }

      for (const exercise of workout.exercises) {
        if (exercise.sets.length === 0) {
          throw new BadRequestException(
            'Every program exercise must contain at least one set',
          );
        }
      }
    }
  }

  private assertTrainer(actor: TrainingProgramActor): void {
    if (actor.role !== 'TRAINER') {
      throw new ForbiddenException(
        'Only trainers can manage training programs',
      );
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
