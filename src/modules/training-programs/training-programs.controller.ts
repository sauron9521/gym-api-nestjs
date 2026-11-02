import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { Authenticate, CurrentUser } from '@nestjs/authentication';

import { TrainingProgramsService } from './training-programs.service.js';
import type { TrainingProgramActor } from './types/training-program.types.js';

import {
  trainingProgramIdSchema,
  trainingProgramVersionIdSchema,
  trainingProgramWorkoutIdSchema,
  trainingProgramExerciseIdSchema,
  trainingProgramSetIdSchema,
} from './dto/training-program.schemas.js';

import {
  type CreateTrainingProgramDto,
  createTrainingProgramSchema,
} from './dto/create-training-program.dto.js';

import {
  type UpdateTrainingProgramDraftDto,
  updateTrainingProgramDraftSchema,
} from './dto/update-training-program-draft.dto.js';

import {
  type QueryTrainingProgramsDto,
  queryTrainingProgramsSchema,
} from './dto/query-training-programs.dto.js';

import {
  type CreateTrainingProgramWorkoutDto,
  createTrainingProgramWorkoutSchema,
} from './dto/create-training-program-workout.dto.js';

import {
  type UpdateTrainingProgramWorkoutDto,
  updateTrainingProgramWorkoutSchema,
} from './dto/update-training-program-workout.dto.js';

import {
  type AddTrainingProgramExerciseDto,
  addTrainingProgramExerciseSchema,
} from './dto/add-training-program-exercise.dto.js';

import {
  type UpdateTrainingProgramExerciseDto,
  updateTrainingProgramExerciseSchema,
} from './dto/update-training-program-exercise.dto.js';

import {
  type ReorderTrainingProgramExercisesDto,
  reorderTrainingProgramExercisesSchema,
} from './dto/reorder-training-program-exercises.dto.js';

import {
  type CreateTrainingProgramSetDto,
  createTrainingProgramSetSchema,
} from './dto/create-training-program-set.dto.js';

import {
  type UpdateTrainingProgramSetDto,
  updateTrainingProgramSetSchema,
} from './dto/update-training-program-set.dto.js';

import {
  type ReorderTrainingProgramSetsDto,
  reorderTrainingProgramSetsSchema,
} from './dto/reorder-training-program-sets.dto.js';

@Controller('training-programs')
@Authenticate()
export class TrainingProgramsController {
  constructor(
    private readonly trainingProgramsService: TrainingProgramsService,
  ) {}

  // PROGRAMS

  @Post()
  create(
    @CurrentUser() actor: TrainingProgramActor,
    @Body({ schema: createTrainingProgramSchema })
    body: CreateTrainingProgramDto,
  ) {
    return this.trainingProgramsService.create(actor, body);
  }

  @Get()
  findMany(
    @CurrentUser() actor: TrainingProgramActor,
    @Query({ schema: queryTrainingProgramsSchema })
    query: QueryTrainingProgramsDto,
  ) {
    return this.trainingProgramsService.findMany(actor, query);
  }

  @Get(':programId')
  findOne(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.findOne(programId, actor);
  }

  @Delete(':programId')
  archive(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.archive(programId, actor);
  }

  // VERSIONS

  @Get(':programId/versions')
  findVersions(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.findVersions(programId, actor);
  }

  @Post(':programId/versions/drafts')
  createNextDraft(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.createNextDraft(programId, actor);
  }

  @Get(':programId/versions/:versionId')
  findVersion(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.findVersion(
      programId,
      versionId,
      actor,
    );
  }

  @Patch(':programId/versions/:versionId')
  updateDraftVersion(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @CurrentUser() actor: TrainingProgramActor,
    @Body({ schema: updateTrainingProgramDraftSchema })
    body: UpdateTrainingProgramDraftDto,
  ) {
    return this.trainingProgramsService.updateDraftVersion(
      programId,
      versionId,
      actor,
      body,
    );
  }

  @Post(':programId/versions/:versionId/publish')
  @HttpCode(HttpStatus.OK)
  publishVersion(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.publishVersion(
      programId,
      versionId,
      actor,
    );
  }

  // WORKOUTS INSIDE PROGRAM VERSION

  @Post(':programId/versions/:versionId/workouts')
  createWorkout(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @CurrentUser() actor: TrainingProgramActor,
    @Body({ schema: createTrainingProgramWorkoutSchema })
    body: CreateTrainingProgramWorkoutDto,
  ) {
    return this.trainingProgramsService.createWorkout(
      actor,
      programId,
      versionId,
      body,
    );
  }

  @Patch(':programId/versions/:versionId/workouts/:workoutId')
  updateWorkout(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @Param('workoutId', { schema: trainingProgramWorkoutIdSchema })
    workoutId: string,
    @CurrentUser() actor: TrainingProgramActor,
    @Body({ schema: updateTrainingProgramWorkoutSchema })
    body: UpdateTrainingProgramWorkoutDto,
  ) {
    return this.trainingProgramsService.updateWorkout(
      actor,
      programId,
      versionId,
      workoutId,
      body,
    );
  }

  @Delete(':programId/versions/:versionId/workouts/:workoutId')
  deleteWorkout(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @Param('workoutId', { schema: trainingProgramWorkoutIdSchema })
    workoutId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.deleteWorkout(
      actor,
      programId,
      versionId,
      workoutId,
    );
  }

  // EXERCISES INSIDE WORKOUT

  @Post(':programId/versions/:versionId/workouts/:workoutId/exercises')
  addExercise(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @Param('workoutId', { schema: trainingProgramWorkoutIdSchema })
    workoutId: string,
    @CurrentUser() actor: TrainingProgramActor,
    @Body({ schema: addTrainingProgramExerciseSchema })
    body: AddTrainingProgramExerciseDto,
  ) {
    return this.trainingProgramsService.addExercise(
      actor,
      programId,
      versionId,
      workoutId,
      body,
    );
  }

  @Patch(':programId/versions/:versionId/workouts/:workoutId/exercises/reorder')
  reorderExercises(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @Param('workoutId', { schema: trainingProgramWorkoutIdSchema })
    workoutId: string,
    @CurrentUser() actor: TrainingProgramActor,
    @Body({ schema: reorderTrainingProgramExercisesSchema })
    body: ReorderTrainingProgramExercisesDto,
  ) {
    return this.trainingProgramsService.reorderExercises(
      actor,
      programId,
      versionId,
      workoutId,
      body,
    );
  }

  @Patch(
    ':programId/versions/:versionId/workouts/:workoutId/exercises/:exerciseId',
  )
  updateExercise(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @Param('workoutId', { schema: trainingProgramWorkoutIdSchema })
    workoutId: string,
    @Param('exerciseId', { schema: trainingProgramExerciseIdSchema })
    exerciseId: string,
    @CurrentUser() actor: TrainingProgramActor,
    @Body({ schema: updateTrainingProgramExerciseSchema })
    body: UpdateTrainingProgramExerciseDto,
  ) {
    return this.trainingProgramsService.updateExercise(
      actor,
      programId,
      versionId,
      workoutId,
      exerciseId,
      body,
    );
  }

  @Delete(
    ':programId/versions/:versionId/workouts/:workoutId/exercises/:exerciseId',
  )
  removeExercise(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @Param('workoutId', { schema: trainingProgramWorkoutIdSchema })
    workoutId: string,
    @Param('exerciseId', { schema: trainingProgramExerciseIdSchema })
    exerciseId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.removeExercise(
      actor,
      programId,
      versionId,
      workoutId,
      exerciseId,
    );
  }

  // SETS INSIDE PROGRAM EXERCISE

  @Post(
    ':programId/versions/:versionId/workouts/:workoutId/exercises/:exerciseId/sets',
  )
  addSet(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @Param('workoutId', { schema: trainingProgramWorkoutIdSchema })
    workoutId: string,
    @Param('exerciseId', { schema: trainingProgramExerciseIdSchema })
    exerciseId: string,
    @CurrentUser() actor: TrainingProgramActor,
    @Body({ schema: createTrainingProgramSetSchema })
    body: CreateTrainingProgramSetDto,
  ) {
    return this.trainingProgramsService.addSet(
      actor,
      programId,
      versionId,
      workoutId,
      exerciseId,
      body,
    );
  }

  @Patch(
    ':programId/versions/:versionId/workouts/:workoutId/exercises/:exerciseId/sets/reorder',
  )
  reorderSets(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @Param('workoutId', { schema: trainingProgramWorkoutIdSchema })
    workoutId: string,
    @Param('exerciseId', { schema: trainingProgramExerciseIdSchema })
    exerciseId: string,
    @CurrentUser() actor: TrainingProgramActor,
    @Body({ schema: reorderTrainingProgramSetsSchema })
    body: ReorderTrainingProgramSetsDto,
  ) {
    return this.trainingProgramsService.reorderSets(
      actor,
      programId,
      versionId,
      workoutId,
      exerciseId,
      body,
    );
  }

  @Patch(
    ':programId/versions/:versionId/workouts/:workoutId/exercises/:exerciseId/sets/:setId',
  )
  updateSet(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @Param('workoutId', { schema: trainingProgramWorkoutIdSchema })
    workoutId: string,
    @Param('exerciseId', { schema: trainingProgramExerciseIdSchema })
    exerciseId: string,
    @Param('setId', { schema: trainingProgramSetIdSchema })
    setId: string,
    @CurrentUser() actor: TrainingProgramActor,
    @Body({ schema: updateTrainingProgramSetSchema })
    body: UpdateTrainingProgramSetDto,
  ) {
    return this.trainingProgramsService.updateSet(
      actor,
      programId,
      versionId,
      workoutId,
      exerciseId,
      setId,
      body,
    );
  }

  @Delete(
    ':programId/versions/:versionId/workouts/:workoutId/exercises/:exerciseId/sets/:setId',
  )
  removeSet(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @Param('workoutId', { schema: trainingProgramWorkoutIdSchema })
    workoutId: string,
    @Param('exerciseId', { schema: trainingProgramExerciseIdSchema })
    exerciseId: string,
    @Param('setId', { schema: trainingProgramSetIdSchema })
    setId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.removeSet(
      actor,
      programId,
      versionId,
      workoutId,
      exerciseId,
      setId,
    );
  }
}
