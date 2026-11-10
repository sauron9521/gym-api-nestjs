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
  type CreateTrainingProgramWorkoutDto,
  createTrainingProgramWorkoutSchema,
} from './dto/create-training-program-workout.dto.js';
import {
  type UpdateTrainingProgramWorkoutDto,
  updateTrainingProgramWorkoutSchema,
} from './dto/update-training-program-workout.dto.js';
import {
  trainingProgramIdSchema,
  trainingProgramVersionIdSchema,
  trainingProgramWorkoutIdSchema,
} from './dto/training-program.schemas.js';
import { TrainingProgramsService } from './services/training-programs.service.js';
import type { TrainingProgramActor } from './types/training-program.types.js';

/** Manage workouts inside a training-program version without changing public route paths. */
@ApiTags('Training Programs')
@ApiCookieAuth('sessionCookie')
@ApiBearerAuth('accessToken')
@Controller('training-programs')
@Authenticate()
export class TrainingProgramWorkoutsController {
  constructor(private readonly trainingProgramsService: TrainingProgramsService) {}

  // WORKOUTS INSIDE PROGRAM VERSION

  @Post(':programId/versions/:versionId/workouts')
  @ApiCreatedResponse({ schema: trainingProgramVersionResponseSchema })
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
  @ApiOkResponse({ schema: trainingProgramVersionResponseSchema })
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
  @ApiOkResponse({ schema: trainingProgramVersionResponseSchema })
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
}
