import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../../../infra/database/generated/prisma/client.js';
import { ExercisesService } from '../../exercises/exercises.service.js';

import { TrainingProgramExerciseRepository } from '../repositories/training-program-exercise.repository.js';
import { TrainingProgramAccessService } from './training-program-access.service.js';

import type {
  AddTrainingProgramExerciseInput,
  ReorderTrainingProgramExercisesInput,
  TrainingProgramActor,
  UpdateTrainingProgramExerciseInput,
} from '../types/training-program.types.js';

@Injectable()
export class TrainingProgramExerciseService {
  constructor(
    private readonly repository: TrainingProgramExerciseRepository,
    private readonly exercisesService: ExercisesService,
    private readonly accessService: TrainingProgramAccessService,
  ) {}

  async addExercise(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    input: AddTrainingProgramExerciseInput,
  ) {
    const workout = await this.accessService.assertEditableWorkout(
      actor,
      programId,
      versionId,
      workoutId,
    );

    const exercise =
      await this.exercisesService.findAvailableForTrainingProgram(
        input.exerciseId,
        actor,
      );

    const sortOrder =
      Math.max(-1, ...workout.exercises.map((item) => item.sortOrder)) + 1;

    try {
      return await this.repository.createProgramExercise(
        programId,
        versionId,
        workoutId,
        {
          exerciseId: exercise.id,
          exerciseNameSnapshot: exercise.name,
          exerciseTypeSnapshot: exercise.exerciseType,
          sortOrder,
          notes: input.notes ?? null,
        },
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException(
          'Exercise order has changed. Reload and try again.',
        );
      }

      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException('The draft version is no longer editable.');
      }

      throw error;
    }
  }

  async updateExercise(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    exerciseId: string,
    input: UpdateTrainingProgramExerciseInput,
  ) {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one field must be provided.');
    }

    const workout = await this.accessService.assertEditableWorkout(
      actor,
      programId,
      versionId,
      workoutId,
    );

    if (!workout.exercises.some((item) => item.id === exerciseId)) {
      throw new NotFoundException('Program exercise not found.');
    }

    try {
      return await this.repository.updateProgramExercise(
        programId,
        versionId,
        workoutId,
        exerciseId,
        input,
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException('The draft version is no longer editable.');
      }

      throw error;
    }
  }

  async removeExercise(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    exerciseId: string,
  ) {
    const workout = await this.accessService.assertEditableWorkout(
      actor,
      programId,
      versionId,
      workoutId,
    );

    if (!workout.exercises.some((item) => item.id === exerciseId)) {
      throw new NotFoundException('Program exercise not found.');
    }

    try {
      return await this.repository.deleteProgramExercise(
        programId,
        versionId,
        workoutId,
        exerciseId,
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException('The draft version is no longer editable.');
      }

      throw error;
    }
  }

  async reorderExercises(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    input: ReorderTrainingProgramExercisesInput,
  ) {
    const workout = await this.accessService.assertEditableWorkout(
      actor,
      programId,
      versionId,
      workoutId,
    );

    const exerciseIds: string[] = input.exerciseIds;

    if (
      new Set(exerciseIds).size !== exerciseIds.length ||
      exerciseIds.length !== workout.exercises.length ||
      !exerciseIds.every((id) =>
        workout.exercises.some((item) => item.id === id),
      )
    ) {
      throw new BadRequestException(
        'The order must contain every workout exercise exactly once.',
      );
    }

    try {
      return await this.repository.reorderProgramExercises(
        programId,
        versionId,
        workoutId,
        exerciseIds,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'INVALID_EXERCISE_ORDER'
      ) {
        throw new BadRequestException('Invalid exercise order.');
      }

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
