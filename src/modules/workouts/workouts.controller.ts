import { Throttle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import type {
  CreateWorkoutFromProgramInput,
  WorkoutActor,
} from './types/workout.types.js';

import { createWorkoutFromProgramSchema } from './dto/create-workout-from-program.dto.js';

import { Authenticate, CurrentUser } from '@nestjs/authentication';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiTags, ApiOkResponse, ApiCreatedResponse, ApiQuery } from '@nestjs/swagger';
import {
  workoutListResponseSchema,
  workoutSummaryListResponseSchema,
  workoutResponseSchema,
  workoutSetResponseSchema,
} from '#src/infra/openapi/response-contracts';

import { WorkoutsService } from './services/workouts.service.js';

import { workoutIdSchema, workoutSetIdSchema } from './dto/workout.schemas.js';

import {
  type CreateWorkoutDto,
  createWorkoutSchema,
} from './dto/create-workout.dto.js';

import {
  type UpdateWorkoutDto,
  updateWorkoutSchema,
} from './dto/update-workout.dto.js';

import {
  type QueryWorkoutsDto,
  queryWorkoutsSchema,
} from './dto/query-workouts.dto.js';

import {
  type UpdateWorkoutSetDto,
  updateWorkoutSetSchema,
} from './dto/update-workout-set.dto.js';

@ApiTags('Workouts')
@ApiCookieAuth('sessionCookie')
@ApiBearerAuth('accessToken')
@Controller('workouts')
@Authenticate()
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post()
  @ApiCreatedResponse({ schema: workoutResponseSchema })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Reuse the same key for retries of the same creation request.' })
  create(
    @CurrentUser() user: WorkoutActor,
    @Body({ schema: createWorkoutSchema })
    body: CreateWorkoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.workoutsService.create(user, body, idempotencyKey);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  @ApiQuery({
    name: 'view',
    required: false,
    enum: ['full', 'summary'],
    description: 'Optional compact view; full remains the default for compatibility.',
  })
  @ApiOkResponse({
    schema: { oneOf: [workoutListResponseSchema, workoutSummaryListResponseSchema] },
  })
  findMany(
    @CurrentUser() user: WorkoutActor,
    @Query({ schema: queryWorkoutsSchema })
    query: QueryWorkoutsDto,
  ) {
    return this.workoutsService.findMany(user, query);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':id')
  @ApiOkResponse({ schema: workoutResponseSchema })
  findOne(
    @Param('id', { schema: workoutIdSchema }) id: string,
    @CurrentUser() user: WorkoutActor,
  ) {
    return this.workoutsService.findOne(id, user);
  }

  @Patch(':id')
  @ApiOkResponse({ schema: workoutResponseSchema })
  update(
    @Param('id', { schema: workoutIdSchema }) id: string,
    @CurrentUser() user: WorkoutActor,
    @Body({ schema: updateWorkoutSchema })
    body: UpdateWorkoutDto,
  ) {
    return this.workoutsService.update(id, user, body);
  }

  @Post(':id/start')
  @ApiOkResponse({ schema: workoutResponseSchema })
  @HttpCode(HttpStatus.OK)
  start(
    @Param('id', { schema: workoutIdSchema }) id: string,
    @CurrentUser() user: WorkoutActor,
  ) {
    return this.workoutsService.start(id, user);
  }

  @Patch(':id/sets/:setId')
  @ApiOkResponse({ schema: workoutSetResponseSchema })
  updateSet(
    @Param('id', { schema: workoutIdSchema }) workoutId: string,
    @Param('setId', { schema: workoutSetIdSchema }) setId: string,
    @CurrentUser() user: WorkoutActor,
    @Body({ schema: updateWorkoutSetSchema })
    body: UpdateWorkoutSetDto,
  ) {
    return this.workoutsService.updateSet(workoutId, setId, user, body);
  }

  @Post(':id/complete')
  @ApiOkResponse({ schema: workoutResponseSchema })
  @HttpCode(HttpStatus.OK)
  complete(
    @Param('id', { schema: workoutIdSchema }) id: string,
    @CurrentUser() user: WorkoutActor,
  ) {
    return this.workoutsService.complete(id, user);
  }

  @Post(':id/cancel')
  @ApiOkResponse({ schema: workoutResponseSchema })
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', { schema: workoutIdSchema }) id: string,
    @CurrentUser() user: WorkoutActor,
  ) {
    return this.workoutsService.cancel(id, user);
  }

  @Post('from-program')
  @ApiCreatedResponse({ schema: workoutResponseSchema })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Reuse the same key for retries of the same creation request.' })
  createFromProgram(
    @CurrentUser() actor: WorkoutActor,
    @Body({ schema: createWorkoutFromProgramSchema })
    body: CreateWorkoutFromProgramInput,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.workoutsService.createFromProgram(actor, body, idempotencyKey);
  }
}
