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
  trainingProgramExerciseIdSchema,
  trainingProgramIdSchema,
  trainingProgramVersionIdSchema,
  trainingProgramWorkoutIdSchema,
} from './dto/training-program.schemas.js';
import { TrainingProgramsService } from './services/training-programs.service.js';
import type { TrainingProgramActor } from './types/training-program.types.js';

/** HTTP endpoints for managing exercises inside a training-program workout. */
@ApiTags('Training Programs')
@ApiCookieAuth('sessionCookie')
@ApiBearerAuth('accessToken')
@Controller('training-programs')
@Authenticate()
export class TrainingProgramExercisesController {
  constructor(private readonly trainingProgramsService: TrainingProgramsService) {}

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
}
