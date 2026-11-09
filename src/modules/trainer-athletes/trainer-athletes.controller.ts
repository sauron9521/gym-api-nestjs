import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { Authenticate, CurrentUser } from '@nestjs/authentication';
import { ApiBearerAuth, ApiCookieAuth, ApiTags, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import {
  trainerAthleteResponseSchema,
  trainerAthletePublicResponseSchema,
  trainerAthleteListResponseSchema,
} from '#src/infra/openapi/response-contracts';

import { TrainerAthletesService } from './trainer-athletes.service.js';

import type { TrainerAthleteActor } from './types/trainer-athlete.types.js';

import { trainerAthleteIdSchema } from './dto/trainer-athlete.schemas.js';

import {
  type CreateTrainerAthleteDto,
  createTrainerAthleteSchema,
} from './dto/create-trainer-athlete.dto.js';

import {
  type QueryTrainerAthletesDto,
  queryTrainerAthletesSchema,
} from './dto/query-trainer-athletes.dto.js';

import {
  type TerminateTrainerAthleteDto,
  terminateTrainerAthleteSchema,
} from './dto/terminate-trainer-athlete.dto.js';

@ApiTags('Trainer & Athlete Relationships')
@ApiCookieAuth('sessionCookie')
@ApiBearerAuth('accessToken')
@Controller('trainer-athletes')
@Authenticate()
export class TrainerAthletesController {
  constructor(
    private readonly trainerAthletesService: TrainerAthletesService,
  ) {}

  @Post()
  @ApiCreatedResponse({ schema: trainerAthleteResponseSchema })
  create(
    @CurrentUser() user: TrainerAthleteActor,
    @Body({ schema: createTrainerAthleteSchema })
    body: CreateTrainerAthleteDto,
  ) {
    return this.trainerAthletesService.create(user, body);
  }

  @Get()
  @ApiOkResponse({ schema: trainerAthleteListResponseSchema })
  findMany(
    @CurrentUser() user: TrainerAthleteActor,
    @Query({ schema: queryTrainerAthletesSchema })
    query: QueryTrainerAthletesDto,
  ) {
    return this.trainerAthletesService.findMany(user, query);
  }

  @Get(':id')
  @ApiOkResponse({ schema: trainerAthletePublicResponseSchema })
  findOne(
    @Param('id', { schema: trainerAthleteIdSchema }) id: string,
    @CurrentUser() user: TrainerAthleteActor,
  ) {
    return this.trainerAthletesService.findOne(id, user);
  }

  @Post(':id/accept')
  @ApiOkResponse({ schema: trainerAthleteResponseSchema })
  @HttpCode(HttpStatus.OK)
  accept(
    @Param('id', { schema: trainerAthleteIdSchema }) id: string,
    @CurrentUser() user: TrainerAthleteActor,
  ) {
    return this.trainerAthletesService.accept(id, user);
  }

  @Post(':id/decline')
  @ApiOkResponse({ schema: trainerAthleteResponseSchema })
  @HttpCode(HttpStatus.OK)
  decline(
    @Param('id', { schema: trainerAthleteIdSchema }) id: string,
    @CurrentUser() user: TrainerAthleteActor,
  ) {
    return this.trainerAthletesService.decline(id, user);
  }

  @Post(':id/cancel')
  @ApiOkResponse({ schema: trainerAthletePublicResponseSchema })
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', { schema: trainerAthleteIdSchema }) id: string,
    @CurrentUser() user: TrainerAthleteActor,
    @Body({ schema: terminateTrainerAthleteSchema })
    body: TerminateTrainerAthleteDto,
  ) {
    return this.trainerAthletesService.cancel(id, user, body ?? {});
  }

  @Post(':id/terminate')
  @ApiOkResponse({ schema: trainerAthletePublicResponseSchema })
  @HttpCode(HttpStatus.OK)
  terminate(
    @Param('id', { schema: trainerAthleteIdSchema }) id: string,
    @CurrentUser() user: TrainerAthleteActor,
    @Body({ schema: terminateTrainerAthleteSchema })
    body: TerminateTrainerAthleteDto,
  ) {
    return this.trainerAthletesService.terminate(id, user, body ?? {});
  }
}
