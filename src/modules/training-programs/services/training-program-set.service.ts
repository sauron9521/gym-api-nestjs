import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../../../infra/database/generated/prisma/client.js';

import { TrainingProgramSetRepository } from '../repositories/training-program-set.repository.js';
import { TrainingProgramAccessService } from './training-program-access.service.js';

import type {
  CreateTrainingProgramSetInput,
  ReorderTrainingProgramSetsInput,
  TrainingProgramActor,
  UpdateTrainingProgramSetInput,
} from '../types/training-program.types.js';

@Injectable()
export class TrainingProgramSetService {
  constructor(
    private readonly repository: TrainingProgramSetRepository,
    private readonly accessService: TrainingProgramAccessService,
  ) {}

  async addSet(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    input: CreateTrainingProgramSetInput,
  ) {
    const exercise = await this.accessService.assertEditableProgramExercise(
      actor,
      programId,
      versionId,
      workoutId,
      programExerciseId,
    );

    const setNumber =
      Math.max(0, ...exercise.sets.map((set) => set.setNumber)) + 1;

    try {
      return await this.repository.createProgramSet(
        programId,
        versionId,
        workoutId,
        programExerciseId,
        {
          setNumber,
          setType: input.setType ?? 'WORKING',
          plannedReps: input.plannedReps ?? null,
          plannedWeightKg: input.plannedWeightKg ?? null,
          plannedDurationSeconds: input.plannedDurationSeconds ?? null,
          plannedDistanceMeters: input.plannedDistanceMeters ?? null,
          restSeconds: input.restSeconds ?? null,
          targetRpe: input.targetRpe ?? null,
          targetRir: input.targetRir ?? null,
          notes: input.notes ?? null,
        },
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException(
          'Set number already exists. Reload and try again.',
        );
      }

      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException(
          'The draft version or exercise is no longer editable.',
        );
      }

      throw error;
    }
  }

  async updateSet(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    setId: string,
    input: UpdateTrainingProgramSetInput,
  ) {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one field must be provided.');
    }

    const exercise = await this.accessService.assertEditableProgramExercise(
      actor,
      programId,
      versionId,
      workoutId,
      programExerciseId,
    );

    if (!exercise.sets.some((set) => set.id === setId)) {
      throw new NotFoundException('Program set not found.');
    }

    try {
      return await this.repository.updateProgramSet(
        programId,
        versionId,
        workoutId,
        programExerciseId,
        setId,
        input,
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException('The draft version is no longer editable.');
      }

      throw error;
    }
  }

  async removeSet(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    setId: string,
  ) {
    const exercise = await this.accessService.assertEditableProgramExercise(
      actor,
      programId,
      versionId,
      workoutId,
      programExerciseId,
    );

    if (!exercise.sets.some((set) => set.id === setId)) {
      throw new NotFoundException('Program set not found.');
    }

    try {
      return await this.repository.deleteProgramSet(
        programId,
        versionId,
        workoutId,
        programExerciseId,
        setId,
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException('The draft version is no longer editable.');
      }

      throw error;
    }
  }

  async reorderSets(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    input: ReorderTrainingProgramSetsInput,
  ) {
    const exercise = await this.accessService.assertEditableProgramExercise(
      actor,
      programId,
      versionId,
      workoutId,
      programExerciseId,
    );

    const { setIds } = input;

    if (
      new Set(setIds).size !== setIds.length ||
      setIds.length !== exercise.sets.length ||
      !setIds.every((id) => exercise.sets.some((set) => set.id === id))
    ) {
      throw new BadRequestException(
        'The order must contain every set exactly once.',
      );
    }

    try {
      return await this.repository.reorderProgramSets(
        programId,
        versionId,
        workoutId,
        programExerciseId,
        setIds,
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_SET_ORDER') {
        throw new BadRequestException('Invalid set order.');
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
