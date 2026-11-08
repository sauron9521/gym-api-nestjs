import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';

import { TrainingProgramVersionRepository } from '../repositories/training-program-version.repository.js';
import { assertPublishableVersion } from '../policies/training-program-publication.policy.js';
import { TrainingProgramCrudService } from './training-program-crud.service.js';

import type {
  TrainingProgramActor,
  UpdateTrainingProgramDraftInput,
} from '../types/training-program.types.js';

@Injectable()
export class TrainingProgramVersionService {
  constructor(
    private readonly repository: TrainingProgramVersionRepository,
    private readonly crudService: TrainingProgramCrudService,
  ) {}

  // ===========================================================================
  // FIND VERSIONS
  // ===========================================================================
  async findVersions(programId: string, actor: TrainingProgramActor) {
    await this.crudService.findOne(programId, actor);

    return this.repository.findVersions(programId);
  }

  // ===========================================================================
  // FIND VERSION DETAILS
  // ===========================================================================
  async findVersion(
    programId: string,
    versionId: string,
    actor: TrainingProgramActor,
  ) {
    await this.crudService.findOne(programId, actor);

    const version = await this.repository.findVersionById(versionId, {
      programId,
    });

    if (!version) {
      throw new NotFoundException('Training program version not found');
    }

    return version;
  }

  // ===========================================================================
  // CREATE NEXT DRAFT
  // ===========================================================================
  async createNextDraft(programId: string, actor: TrainingProgramActor) {
    const program = await this.crudService.findOne(programId, actor);

    if (program.status === 'ARCHIVED') {
      throw new ConflictException('An archived program cannot be edited');
    }

    const existingDraft = await this.repository.findDraftVersion(programId);

    if (existingDraft) {
      throw new ConflictException('This program already has a draft version');
    }

    let draft: Awaited<
      ReturnType<
        TrainingProgramVersionRepository['createDraftFromLatestPublished']
      >
    >;

    try {
      draft = await this.repository.createDraftFromLatestPublished(programId);
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException(
          'A draft version already exists or was created concurrently',
        );
      }

      throw error;
    }

    if (!draft) {
      throw new ConflictException(
        'No published version is available to create a new draft',
      );
    }

    return draft;
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
    const program = await this.crudService.findOne(programId, actor);

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

    // Fast feedback for the client; the repository repeats this under a row
    // lock to protect against concurrent workout edits.
    const requestedWeeks = input.durationWeeks;
    if (
      typeof requestedWeeks === 'number' &&
      version.workouts.some((workout) => workout.weekNumber > requestedWeeks)
    ) {
      throw new BadRequestException(
        'A workout week cannot exceed the program duration',
      );
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
      return await this.repository.updateVersion(
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
    const program = await this.crudService.findOne(programId, actor);

    if (program.status === 'ARCHIVED') {
      throw new ConflictException('An archived program cannot be published');
    }

    const version = await this.findVersion(programId, versionId, actor);

    if (version.status !== 'DRAFT') {
      throw new ConflictException('Only draft versions can be published');
    }

    assertPublishableVersion(version);

    const published = await this.repository.publishVersion(
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
  // PRIVATE METHODS
  // ===========================================================================
  private isPrismaError(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }


}
