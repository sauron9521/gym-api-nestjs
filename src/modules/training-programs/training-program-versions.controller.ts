import { Authenticate, CurrentUser } from '@nestjs/authentication';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  trainingProgramVersionResponseSchema,
  trainingProgramVersionListItemSchema,
} from '#src/infra/openapi/response-contracts';
import {
  trainingProgramIdSchema,
  trainingProgramVersionIdSchema,
} from './dto/training-program.schemas.js';
import {
  type UpdateTrainingProgramDraftDto,
  updateTrainingProgramDraftSchema,
} from './dto/update-training-program-draft.dto.js';
import { TrainingProgramsService } from './services/training-programs.service.js';
import type { TrainingProgramActor } from './types/training-program.types.js';

@ApiTags('Training Programs')
@ApiCookieAuth('sessionCookie')
@ApiBearerAuth('accessToken')
@Controller('training-programs')
@Authenticate()
export class TrainingProgramVersionsController {
  constructor(private readonly trainingProgramsService: TrainingProgramsService) {}

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
}
