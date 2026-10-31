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

import { ExercisesService } from './exercises.service.js';

import type {
  ExerciseAccessContext,
  ExerciseActor,
} from './types/exercise.types.js';

import {
  type CreateExerciseDto,
  createExerciseSchema,
} from './dto/create-exercise.dto.js';

import {
  type UpdateExerciseDto,
  updateExerciseSchema,
} from './dto/update-exercise.dto.js';

import {
  type QueryExercisesDto,
  queryExercisesSchema,
} from './dto/query-exercises.dto.js';

import { exerciseIdSchema } from './dto/exercise.schemas.js';

const EMPTY_ACCESS_CONTEXT: ExerciseAccessContext = {
  activeTrainerIds: [],
  activeAthleteIds: [],
};

@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Get()
  @Authenticate({ optional: true })
  findMany(
    @CurrentUser() user: ExerciseActor | null,
    @Query({ schema: queryExercisesSchema })
    query: QueryExercisesDto,
  ) {
    return this.exercisesService.findMany(user, query, EMPTY_ACCESS_CONTEXT);
  }

  @Get(':id')
  @Authenticate({ optional: true })
  findOne(
    @Param('id', { schema: exerciseIdSchema }) id: string,
    @CurrentUser() user: ExerciseActor | null,
  ) {
    return this.exercisesService.findOne(id, user, EMPTY_ACCESS_CONTEXT);
  }

  @Post()
  create(
    @CurrentUser() user: ExerciseActor,
    @Body({ schema: createExerciseSchema })
    body: CreateExerciseDto,
  ) {
    return this.exercisesService.create(user, body);
  }

  @Patch(':id')
  update(
    @Param('id', { schema: exerciseIdSchema }) id: string,
    @CurrentUser() user: ExerciseActor,
    @Body({ schema: updateExerciseSchema })
    body: UpdateExerciseDto,
  ) {
    return this.exercisesService.update(id, user, body);
  }

  @Delete(':id')
  archive(
    @Param('id', { schema: exerciseIdSchema }) id: string,
    @CurrentUser() user: ExerciseActor,
  ) {
    return this.exercisesService.archive(id, user);
  }
}
