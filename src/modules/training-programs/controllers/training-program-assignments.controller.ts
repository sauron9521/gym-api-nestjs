import { Authenticate, CurrentUser } from '@nestjs/authentication';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import {
  trainingAssignmentResponseSchema,
  trainingAssignmentListResponseSchema,
  trainingAssignmentPublicDetailsResponseSchema,
} from '#src/infra/openapi/response-contracts';
import {
  type CreateTrainingProgramAssignmentDto,
  createTrainingProgramAssignmentSchema,
} from '../dto/create-training-program-assignment.dto.js';
import {
  type QueryTrainingProgramAssignmentsDto,
  queryTrainingProgramAssignmentsSchema,
} from '../dto/query-training-program-assignments.dto.js';
import {
  type CancelTrainingProgramAssignmentDto,
  cancelTrainingProgramAssignmentSchema,
} from '../dto/cancel-training-program-assignment.dto.js';
import {
  trainingProgramAssignmentIdSchema,
  trainingProgramIdSchema,
  trainingProgramVersionIdSchema,
} from '../dto/training-program.schemas.js';
import { TrainingProgramsService } from '../services/training-programs.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

/**
 * Assignment endpoints must be registered ahead of the dynamic :programId
 * routes handled by TrainingProgramsController.
 */
@ApiTags('Training Programs')
@ApiCookieAuth('sessionCookie')
@ApiBearerAuth('accessToken')
@Controller('training-programs')
@Authenticate()
export class TrainingProgramAssignmentsController {
  constructor(private readonly trainingProgramsService: TrainingProgramsService) {}

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
}
