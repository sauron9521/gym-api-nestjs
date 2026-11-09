import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { Authenticate, CurrentUser } from '@nestjs/authentication';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  exerciseTrainerAccessListResponseSchema,
  exerciseTrainerAccessResponseSchema,
} from '#src/infra/openapi/response-contracts';
import { exerciseIdSchema } from './dto/exercise.schemas.js';
import {
  exerciseTrainerAccessIdSchema,
  grantExerciseTrainerAccessSchema,
  type GrantExerciseTrainerAccessDto,
} from './dto/exercise-trainer-access.dto.js';
import { ExerciseTrainerAccessService } from './services/exercise-trainer-access.service.js';
import type { ExerciseActor } from './types/exercise.types.js';

@ApiTags('Exercises')
@ApiCookieAuth('sessionCookie')
@ApiBearerAuth('accessToken')
@Authenticate()
@Controller('exercises/:id/trainer-access')
export class ExerciseTrainerAccessController {
  constructor(private readonly accessService: ExerciseTrainerAccessService) {}

  @Get()
  @ApiOkResponse({ schema: exerciseTrainerAccessListResponseSchema })
  list(
    @Param('id', { schema: exerciseIdSchema }) id: string,
    @CurrentUser() user: ExerciseActor,
  ) {
    return this.accessService.list(id, user);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: exerciseTrainerAccessResponseSchema })
  grant(
    @Param('id', { schema: exerciseIdSchema }) id: string,
    @CurrentUser() user: ExerciseActor,
    @Body({ schema: grantExerciseTrainerAccessSchema })
    body: GrantExerciseTrainerAccessDto,
  ) {
    return this.accessService.grant(id, user, body.trainerId);
  }

  @Delete(':trainerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @Param('id', { schema: exerciseIdSchema }) id: string,
    @Param('trainerId', { schema: exerciseTrainerAccessIdSchema })
    trainerId: string,
    @CurrentUser() user: ExerciseActor,
  ) {
    return this.accessService.revoke(id, user, trainerId);
  }
}
