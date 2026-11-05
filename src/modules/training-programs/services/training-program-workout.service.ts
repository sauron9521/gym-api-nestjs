import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';

import { TrainingProgramsRepository } from '../training-programs.repository.js';
import { TrainingProgramAccessService } from './training-program-access.service.js';

import type {
  CreateTrainingProgramWorkoutInput,
  TrainingProgramActor,
  UpdateTrainingProgramWorkoutInput,
} from '../types/training-program.types.js';

@Injectable()
export class TrainingProgramWorkoutService {
  constructor(
    private readonly repository: TrainingProgramsRepository,
    private readonly accessService: TrainingProgramAccessService,
  ) {}

  async createWorkout(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    input: CreateTrainingProgramWorkoutInput,
  ) {
    const version = await this.accessService.assertEditableDraft(
      actor,
      programId,
      versionId,
    );

    if (
      version.durationWeeks !== null &&
      input.weekNumber > version.durationWeeks
    ) {
      throw new BadRequestException('Workout week exceeds program duration.');
    }

    try {
      return await this.repository.createWorkout(programId, versionId, input);
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException(
          'A workout already exists for this week and day.',
        );
      }

      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException('The draft version is no longer editable.');
      }

      throw error;
    }
  }

  async updateWorkout(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    input: UpdateTrainingProgramWorkoutInput,
  ) {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one field must be provided.');
    }

    const version = await this.accessService.assertEditableDraft(
      actor,
      programId,
      versionId,
    );

    if (
      input.weekNumber !== undefined &&
      version.durationWeeks !== null &&
      input.weekNumber > version.durationWeeks
    ) {
      throw new BadRequestException('Workout week exceeds program duration.');
    }

    const workoutExists = version.workouts.some(
      (workout) => workout.id === workoutId,
    );

    if (!workoutExists) {
      throw new NotFoundException('Workout not found.');
    }

    try {
      return await this.repository.updateWorkout(
        programId,
        versionId,
        workoutId,
        input,
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException(
          'A workout already exists for this week and day.',
        );
      }

      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException('The draft version is no longer editable.');
      }

      throw error;
    }
  }

  async deleteWorkout(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
  ) {
    const version = await this.accessService.assertEditableDraft(
      actor,
      programId,
      versionId,
    );

    const workoutExists = version.workouts.some(
      (workout) => workout.id === workoutId,
    );

    if (!workoutExists) {
      throw new NotFoundException('Workout not found.');
    }

    try {
      return await this.repository.deleteWorkout(
        programId,
        versionId,
        workoutId,
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException('The draft version is no longer editable.');
      }

      throw error;
    }
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
