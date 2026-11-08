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
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';

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
import { TrainerAthletesService } from '../trainer-athletes/trainer-athletes.service.js';

const EMPTY_ACCESS_CONTEXT: ExerciseAccessContext = {
  activeTrainerIds: [],
  activeAthleteIds: [],
};

@ApiTags('Exercises')
@Controller('exercises')
export class ExercisesController {
  constructor(
    private readonly exercisesService: ExercisesService,
    private readonly trainerAthletesService: TrainerAthletesService,
  ) {}

  @Get()
  @Authenticate({ optional: true })
  async findMany(
    @CurrentUser() user: ExerciseActor | null,
    @Query({ schema: queryExercisesSchema })
    query: QueryExercisesDto,
  ) {
    const access = user
      ? await this.trainerAthletesService.getExerciseAccessContext(user)
      : EMPTY_ACCESS_CONTEXT;

    return this.exercisesService.findMany(user, query, access);
  }

  @Get(':id')
  @Authenticate({ optional: true })
  async findOne(
    @Param('id', { schema: exerciseIdSchema }) id: string,
    @CurrentUser() user: ExerciseActor | null,
  ) {
    const access = user
      ? await this.trainerAthletesService.getExerciseAccessContext(user)
      : EMPTY_ACCESS_CONTEXT;

    return this.exercisesService.findOne(id, user, access);
  }

  @Post()
  @ApiCookieAuth('sessionCookie')
  @ApiBearerAuth('accessToken')
  create(
    @CurrentUser() user: ExerciseActor,
    @Body({ schema: createExerciseSchema })
    body: CreateExerciseDto,
  ) {
    return this.exercisesService.create(user, body);
  }

  @Patch(':id')
  @ApiCookieAuth('sessionCookie')
  @ApiBearerAuth('accessToken')
  update(
    @Param('id', { schema: exerciseIdSchema }) id: string,
    @CurrentUser() user: ExerciseActor,
    @Body({ schema: updateExerciseSchema })
    body: UpdateExerciseDto,
  ) {
    return this.exercisesService.update(id, user, body);
  }

  @Delete(':id')
  @ApiCookieAuth('sessionCookie')
  @ApiBearerAuth('accessToken')
  archive(
    @Param('id', { schema: exerciseIdSchema }) id: string,
    @CurrentUser() user: ExerciseActor,
  ) {
    return this.exercisesService.archive(id, user);
  }
}
