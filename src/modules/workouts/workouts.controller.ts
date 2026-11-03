import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { Authenticate, CurrentUser } from '@nestjs/authentication';

import { WorkoutsService } from './workouts.service.js';

import type {
  CreateWorkoutFromProgramInput,
  WorkoutActor,
} from './types/workout.types.js';

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
import { createWorkoutFromProgramSchema } from './dto/create-workout-from-program.dto.js';

@Controller('workouts')
@Authenticate()
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post()
  create(
    @CurrentUser() user: WorkoutActor,
    @Body({ schema: createWorkoutSchema })
    body: CreateWorkoutDto,
  ) {
    return this.workoutsService.create(user, body);
  }

  @Get()
  findMany(
    @CurrentUser() user: WorkoutActor,
    @Query({ schema: queryWorkoutsSchema })
    query: QueryWorkoutsDto,
  ) {
    return this.workoutsService.findMany(user, query);
  }

  @Get(':id')
  findOne(
    @Param('id', { schema: workoutIdSchema }) id: string,
    @CurrentUser() user: WorkoutActor,
  ) {
    return this.workoutsService.findOne(id, user);
  }

  @Patch(':id')
  update(
    @Param('id', { schema: workoutIdSchema }) id: string,
    @CurrentUser() user: WorkoutActor,
    @Body({ schema: updateWorkoutSchema })
    body: UpdateWorkoutDto,
  ) {
    return this.workoutsService.update(id, user, body);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  start(
    @Param('id', { schema: workoutIdSchema }) id: string,
    @CurrentUser() user: WorkoutActor,
  ) {
    return this.workoutsService.start(id, user);
  }

  @Patch(':id/sets/:setId')
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
  @HttpCode(HttpStatus.OK)
  complete(
    @Param('id', { schema: workoutIdSchema }) id: string,
    @CurrentUser() user: WorkoutActor,
  ) {
    return this.workoutsService.complete(id, user);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', { schema: workoutIdSchema }) id: string,
    @CurrentUser() user: WorkoutActor,
  ) {
    return this.workoutsService.cancel(id, user);
  }

  @Post('from-program')
  @Authenticate()
  createFromProgram(
    @CurrentUser() actor: WorkoutActor,
    @Body({ schema: createWorkoutFromProgramSchema })
    body: CreateWorkoutFromProgramInput,
  ) {
    return this.workoutsService.createFromProgram(actor, body);
  }
}
