import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { TrainingProgramCrudRepository } from '../repositories/training-program-crud.repository.js';
import { TrainingProgramVersionRepository } from '../repositories/training-program-version.repository.js';

import type { TrainingProgramActor } from '../types/training-program.types.js';

@Injectable()
export class TrainingProgramAccessService {
  constructor(
    private readonly crudRepository: TrainingProgramCrudRepository,
    private readonly versionRepository: TrainingProgramVersionRepository,
  ) {}

  assertTrainer(actor: TrainingProgramActor): void {
    if (actor.role !== 'TRAINER') {
      throw new ForbiddenException(
        'Only trainers can manage training programs',
      );
    }
  }

  async assertEditableDraft(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
  ) {
    this.assertTrainer(actor);

    const program = await this.crudRepository.findProgramById(programId, {
      trainerId: actor.id,
    });

    if (!program) {
      throw new NotFoundException('Training program not found.');
    }

    if (program.status === 'ARCHIVED') {
      throw new ConflictException('Archived programs cannot be modified.');
    }

    const version = await this.versionRepository.findVersionForEditing(versionId, {
      programId,
    });

    if (!version) {
      throw new NotFoundException('Program version not found.');
    }

    if (version.status !== 'DRAFT') {
      throw new ConflictException('Only draft versions can be modified.');
    }

    return version;
  }

  async assertEditableWorkout(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
  ) {
    const version = await this.assertEditableDraft(actor, programId, versionId);

    const workout = version.workouts.find((item) => item.id === workoutId);

    if (!workout) {
      throw new NotFoundException('Workout not found.');
    }

    return workout;
  }

  async assertEditableProgramExercise(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
  ) {
    const workout = await this.assertEditableWorkout(
      actor,
      programId,
      versionId,
      workoutId,
    );

    const exercise = workout.exercises.find(
      (item) => item.id === programExerciseId,
    );

    if (!exercise) {
      throw new NotFoundException('Program exercise not found.');
    }

    return exercise;
  }
}
