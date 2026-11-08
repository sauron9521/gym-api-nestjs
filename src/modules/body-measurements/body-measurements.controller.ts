import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Patch, Post, Query,
} from '@nestjs/common';
import { Authenticate, CurrentUser } from '@nestjs/authentication';

import { BodyMeasurementsService } from './body-measurements.service.js';
import {
  bodyMeasurementIdSchema,
  createBodyMeasurementSchema,
  queryBodyMeasurementsSchema,
  updateBodyMeasurementSchema,
  type CreateBodyMeasurementDto,
  type QueryBodyMeasurementsDto,
  type UpdateBodyMeasurementDto,
} from './dto/body-measurement.schemas.js';

type UserActor = { id: string };

@Authenticate()
@Controller('body-measurements')
export class BodyMeasurementsController {
  constructor(private readonly service: BodyMeasurementsService) {}

  @Post()
  create(
    @CurrentUser() actor: UserActor,
    @Body({ schema: createBodyMeasurementSchema }) input: CreateBodyMeasurementDto,
  ) {
    return this.service.create(actor.id, input);
  }

  @Get()
  findMany(
    @CurrentUser() actor: UserActor,
    @Query({ schema: queryBodyMeasurementsSchema }) query: QueryBodyMeasurementsDto,
  ) {
    return this.service.findMany(actor.id, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() actor: UserActor,
    @Param('id', { schema: bodyMeasurementIdSchema }) id: string,
  ) {
    return this.service.findOne(actor.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: UserActor,
    @Param('id', { schema: bodyMeasurementIdSchema }) id: string,
    @Body({ schema: updateBodyMeasurementSchema }) input: UpdateBodyMeasurementDto,
  ) {
    return this.service.update(actor.id, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() actor: UserActor,
    @Param('id', { schema: bodyMeasurementIdSchema }) id: string,
  ) {
    return this.service.remove(actor.id, id);
  }
}
