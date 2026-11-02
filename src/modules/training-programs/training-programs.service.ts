import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExercisesService } from '../exercises/exercises.service.js';
import { TrainerAthletesService } from '../trainer-athletes/trainer-athletes.service.js';
import { Prisma } from '../../generated/prisma/client.js';

import { TrainingProgramsRepository } from './training-programs.repository.js';

import type {
  AddTrainingProgramExerciseInput,
  CreateTrainingProgramInput,
  CreateTrainingProgramWorkoutInput,
  ReorderTrainingProgramExercisesInput,
  TrainingProgramActor,
  TrainingProgramListQuery,
  UpdateTrainingProgramDraftInput,
  UpdateTrainingProgramExerciseInput,
  UpdateTrainingProgramWorkoutInput,
} from './types/training-program.types.js';

@Injectable()
export class TrainingProgramsService {
  constructor(
    private readonly trainingProgramsRepository: TrainingProgramsRepository,
    private readonly exercisesService: ExercisesService,
    private readonly trainerAthletesService: TrainerAthletesService,
  ) {}

  async createWorkout(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    input: CreateTrainingProgramWorkoutInput,
  ) {
    await this.assertEditableDraft(actor, programId, versionId);

    try {
      return await this.trainingProgramsRepository.createWorkout(
        programId,
        versionId,
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

    const version = await this.assertEditableDraft(actor, programId, versionId);

    const workoutExists = version.workouts.some(
      (workout) => workout.id === workoutId,
    );

    if (!workoutExists) {
      throw new NotFoundException('Workout not found.');
    }

    try {
      return await this.trainingProgramsRepository.updateWorkout(
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
    const version = await this.assertEditableDraft(actor, programId, versionId);

    const workoutExists = version.workouts.some(
      (workout) => workout.id === workoutId,
    );

    if (!workoutExists) {
      throw new NotFoundException('Workout not found.');
    }

    try {
      return await this.trainingProgramsRepository.deleteWorkout(
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

  private async assertEditableDraft(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
  ) {
    this.assertTrainer(actor);

    const program = await this.trainingProgramsRepository.findProgramById(
      programId,
      {
        trainerId: actor.id,
      },
    );

    if (!program) {
      throw new NotFoundException('Training program not found.');
    }

    if (program.status === 'ARCHIVED') {
      throw new ConflictException('Archived programs cannot be modified.');
    }

    const version = await this.trainingProgramsRepository.findVersionById(
      versionId,
      { programId },
    );

    if (!version) {
      throw new NotFoundException('Program version not found.');
    }

    if (version.status !== 'DRAFT') {
      throw new ConflictException('Only draft versions can be modified.');
    }

    return version;
  }

  async addExercise(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    workoutId: string,
    input: AddTrainingProgramExerciseInput,
  ) {
    const version = await this.assertEditableDraft(actor, programId, versionId);

    const workout = version.workouts.find((item) => item.id === workoutId);

    if (!workout) {
      throw new NotFoundException('Workout not found.');
    }

    const access =
      await this.trainerAthletesService.getExerciseAccessContext(actor);

    const exercise = await this.exercisesService.findOne(
      input.exerciseId,
      actor,
      access,
    );

    const sortOrder =
      Math.max(-1, ...workout.exercises.map((item) => item.sortOrder)) + 1;

    try {
      return await this.trainingProgramsRepository.createProgramExercise(
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

    const version = await this.assertEditableDraft(actor, programId, versionId);

    const workout = version.workouts.find((item) => item.id === workoutId);

    if (!workout) {
      throw new NotFoundException('Workout not found.');
    }

    if (!workout.exercises.some((item) => item.id === exerciseId)) {
      throw new NotFoundException('Program exercise not found.');
    }

    try {
      return await this.trainingProgramsRepository.updateProgramExercise(
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
    const version = await this.assertEditableDraft(actor, programId, versionId);

    const workout = version.workouts.find((item) => item.id === workoutId);

    if (!workout) {
      throw new NotFoundException('Workout not found.');
    }

    if (!workout.exercises.some((item) => item.id === exerciseId)) {
      throw new NotFoundException('Program exercise not found.');
    }

    try {
      return await this.trainingProgramsRepository.deleteProgramExercise(
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
    const version = await this.assertEditableDraft(actor, programId, versionId);

    const workout = version.workouts.find((item) => item.id === workoutId);

    if (!workout) {
      throw new NotFoundException('Workout not found.');
    }

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
      return await this.trainingProgramsRepository.reorderProgramExercises(
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
}
