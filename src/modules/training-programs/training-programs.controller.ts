import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { Authenticate, CurrentUser } from '@nestjs/authentication';
import { ApiBearerAuth, ApiCookieAuth, ApiTags, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import {
  trainingProgramResponseSchema,
  trainingProgramListResponseSchema,
  trainingProgramVersionResponseSchema,
} from '#src/infra/openapi/response-contracts';
import { TrainingProgramsService } from './services/training-programs.service.js';
import type { TrainingProgramActor } from './types/training-program.types.js';

import {
  trainingProgramExerciseIdSchema,
  trainingProgramIdSchema,
  trainingProgramSetIdSchema,
  trainingProgramVersionIdSchema,
  trainingProgramWorkoutIdSchema,
} from './dto/training-program.schemas.js';

import {
  type CreateTrainingProgramDto,
  createTrainingProgramSchema,
} from './dto/create-training-program.dto.js';

import {
  type QueryTrainingProgramsDto,
  queryTrainingProgramsSchema,
} from './dto/query-training-programs.dto.js';

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

@ApiTags('Training Programs')
@ApiCookieAuth('sessionCookie')
@ApiBearerAuth('accessToken')
@Controller('training-programs')
@Authenticate()
export class TrainingProgramsController {
  constructor(
    private readonly trainingProgramsService: TrainingProgramsService,
  ) {}

  // PROGRAMS

  @Post()
  @ApiCreatedResponse({ schema: trainingProgramResponseSchema })
  create(
    @CurrentUser() actor: TrainingProgramActor,
    @Body({ schema: createTrainingProgramSchema })
    body: CreateTrainingProgramDto,
  ) {
    return this.trainingProgramsService.create(actor, body);
  }

  @Get()
  @ApiOkResponse({ schema: trainingProgramListResponseSchema })
  findMany(
    @CurrentUser() actor: TrainingProgramActor,
    @Query({ schema: queryTrainingProgramsSchema })
    query: QueryTrainingProgramsDto,
  ) {
    return this.trainingProgramsService.findMany(actor, query);
  }

  @Get(':programId')
  @ApiOkResponse({ schema: trainingProgramResponseSchema })
  findOne(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.findOne(programId, actor);
  }

  @Delete(':programId')
  @ApiOkResponse({ schema: trainingProgramResponseSchema })
  archive(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.archive(programId, actor);
  }

  // EXERCISES INSIDE WORKOUT

  @Post(':programId/versions/:versionId/workouts/:workoutId/exercises')
  @ApiCreatedResponse({ schema: trainingProgramVersionResponseSchema })
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
  @ApiOkResponse({ schema: trainingProgramVersionResponseSchema })
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
  @ApiOkResponse({ schema: trainingProgramVersionResponseSchema })
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
  @ApiOkResponse({ schema: trainingProgramVersionResponseSchema })
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
  @ApiCreatedResponse({ schema: trainingProgramVersionResponseSchema })
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
  @ApiOkResponse({ schema: trainingProgramVersionResponseSchema })
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
  @ApiOkResponse({ schema: trainingProgramVersionResponseSchema })
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
  @ApiOkResponse({ schema: trainingProgramVersionResponseSchema })
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
