import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';

import { Authenticate, CurrentUser } from '@nestjs/authentication';
import { ApiBearerAuth, ApiCookieAuth, ApiTags, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import {
  trainingProgramResponseSchema,
  trainingProgramListResponseSchema,
} from '#src/infra/openapi/response-contracts';
import { TrainingProgramsService } from '../services/training-programs.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

import { trainingProgramIdSchema } from '../dto/training-program.schemas.js';

import {
  type CreateTrainingProgramDto,
  createTrainingProgramSchema,
} from '../dto/create-training-program.dto.js';

import {
  type QueryTrainingProgramsDto,
  queryTrainingProgramsSchema,
} from '../dto/query-training-programs.dto.js';

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
}
