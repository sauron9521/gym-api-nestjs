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
import { ApiBearerAuth, ApiCookieAuth, ApiTags, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import {
  trainingProgramResponseSchema,
  trainingProgramListResponseSchema,
  trainingProgramVersionResponseSchema,
  trainingProgramVersionListItemSchema,
  trainingAssignmentResponseSchema,
  trainingAssignmentListResponseSchema,
  trainingAssignmentPublicDetailsResponseSchema,
} from '../../infra/openapi/response-contracts.js';
import {
  type CreateTrainingProgramAssignmentDto,
  createTrainingProgramAssignmentSchema,
} from './dto/create-training-program-assignment.dto.js';

import { TrainingProgramsService } from './training-programs.service.js';
import type { TrainingProgramActor } from './types/training-program.types.js';

import {
  trainingProgramAssignmentIdSchema,
  trainingProgramExerciseIdSchema,
  trainingProgramIdSchema,
  trainingProgramSetIdSchema,
  trainingProgramVersionIdSchema,
  trainingProgramWorkoutIdSchema,
} from './dto/training-program.schemas.js';

import {
  type QueryTrainingProgramAssignmentsDto,
  queryTrainingProgramAssignmentsSchema,
} from './dto/query-training-program-assignments.dto.js';

import {
  type CancelTrainingProgramAssignmentDto,
  cancelTrainingProgramAssignmentSchema,
} from './dto/cancel-training-program-assignment.dto.js';

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

  // ASSIGNMENTS

  @Get('assignments')
  @ApiOkResponse({ schema: trainingAssignmentListResponseSchema })
  findManyAssignments(
    @CurrentUser() actor: TrainingProgramActor,
    @Query({ schema: queryTrainingProgramAssignmentsSchema })
    query: QueryTrainingProgramAssignmentsDto,
  ) {
    return this.trainingProgramsService.findManyAssignments(actor, query);
  }

  @Get('assignments/:assignmentId')
  @ApiOkResponse({ schema: trainingAssignmentPublicDetailsResponseSchema })
  findOneAssignment(
    @Param('assignmentId', {
      schema: trainingProgramAssignmentIdSchema,
    })
    assignmentId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.findOneAssignmentDetails(
      assignmentId,
      actor,
    );
  }

  @Post('assignments/:assignmentId/complete')
  @ApiOkResponse({ schema: trainingAssignmentResponseSchema })
  @HttpCode(HttpStatus.OK)
  completeAssignment(
    @Param('assignmentId', {
      schema: trainingProgramAssignmentIdSchema,
    })
    assignmentId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.completeAssignment(assignmentId, actor);
  }

  @Post('assignments/:assignmentId/cancel')
  @ApiOkResponse({ schema: trainingAssignmentResponseSchema })
  @HttpCode(HttpStatus.OK)
  cancelAssignment(
    @Param('assignmentId', {
      schema: trainingProgramAssignmentIdSchema,
    })
    assignmentId: string,
    @CurrentUser() actor: TrainingProgramActor,
    @Body({ schema: cancelTrainingProgramAssignmentSchema })
    body: CancelTrainingProgramAssignmentDto,
  ) {
    return this.trainingProgramsService.cancelAssignment(
      assignmentId,
      actor,
      body ?? {},
    );
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

  // VERSIONS

  @Get(':programId/versions')
  @ApiOkResponse({ schema: { type: 'array', items: trainingProgramVersionListItemSchema } })
  findVersions(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.findVersions(programId, actor);
  }

  @Post(':programId/versions/drafts')
  @ApiCreatedResponse({ schema: trainingProgramVersionResponseSchema })
  createNextDraft(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @CurrentUser() actor: TrainingProgramActor,
  ) {
    return this.trainingProgramsService.createNextDraft(programId, actor);
  }

  @Get(':programId/versions/:versionId')
  @ApiOkResponse({ schema: trainingProgramVersionResponseSchema })
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
  @ApiOkResponse({ schema: trainingProgramVersionResponseSchema })
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
  @ApiOkResponse({ schema: trainingProgramVersionResponseSchema })
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

  @Post(':programId/versions/:versionId/assignments')
  @ApiCreatedResponse({ schema: trainingAssignmentResponseSchema })
  assignVersionToAthlete(
    @Param('programId', { schema: trainingProgramIdSchema })
    programId: string,
    @Param('versionId', { schema: trainingProgramVersionIdSchema })
    versionId: string,
    @CurrentUser() actor: TrainingProgramActor,
    @Body({ schema: createTrainingProgramAssignmentSchema })
    body: CreateTrainingProgramAssignmentDto,
  ) {
    return this.trainingProgramsService.assignVersionToAthlete(
      actor,
      programId,
      versionId,
      body,
    );
  }

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
