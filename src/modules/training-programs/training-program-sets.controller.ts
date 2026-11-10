import { Authenticate, CurrentUser } from '@nestjs/authentication';
import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { trainingProgramVersionResponseSchema } from '#src/infra/openapi/response-contracts';
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
import {
  trainingProgramExerciseIdSchema,
  trainingProgramIdSchema,
  trainingProgramSetIdSchema,
  trainingProgramVersionIdSchema,
  trainingProgramWorkoutIdSchema,
} from './dto/training-program.schemas.js';
import { TrainingProgramsService } from './services/training-programs.service.js';
import type { TrainingProgramActor } from './types/training-program.types.js';

/** Manage sets inside training-program exercises without changing existing routes. */
@ApiTags('Training Programs')
@ApiCookieAuth('sessionCookie')
@ApiBearerAuth('accessToken')
@Controller('training-programs')
@Authenticate()
export class TrainingProgramSetsController {
  constructor(private readonly trainingProgramsService: TrainingProgramsService) {}

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
