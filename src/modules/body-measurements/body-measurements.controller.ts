import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Patch, Post, Query,
} from '@nestjs/common';
import { Authenticate, CurrentUser } from '@nestjs/authentication';
import { ApiBearerAuth, ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { BodyMeasurementsService } from './services/body-measurements.service.js';
import { BodyMeasurementStatisticsService } from './services/body-measurement-statistics.service.js';
import {
  bodyMeasurementStatisticsQuerySchema,
  type BodyMeasurementStatisticsQueryDto,
} from './dto/body-measurement-statistics.schemas.js';
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
@ApiTags('Body Measurements')
@ApiCookieAuth('sessionCookie')
@ApiBearerAuth('accessToken')
@Controller('body-measurements')
export class BodyMeasurementsController {
  constructor(
    private readonly service: BodyMeasurementsService,
    private readonly statisticsService: BodyMeasurementStatisticsService,
  ) {}

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

  /** Must appear before the dynamic :id route. */
  @Get('statistics')
  @ApiOkResponse({
    description: 'First/latest metric values, differences over 7/30/90 days and a UTC daily chart series.',
    schema: {
      type: 'object',
      required: ['metric', 'unit', 'range', 'asOf', 'overall', 'changes', 'series'],
      properties: {
        metric: { type: 'string', enum: ['weightKg', 'bodyFatPct', 'chestCm', 'waistCm', 'hipsCm', 'armCm', 'thighCm'] },
        unit: { type: 'string', enum: ['kg', '%', 'cm'] },
        range: { type: 'string', enum: ['7d', '30d', '90d'] },
        asOf: { type: 'string', format: 'date-time' },
        first: { type: 'object', nullable: true, properties: { id: { type: 'string', format: 'uuid' }, measuredAt: { type: 'string', format: 'date-time' }, value: { type: 'number' } } },
        latest: { type: 'object', nullable: true, properties: { id: { type: 'string', format: 'uuid' }, measuredAt: { type: 'string', format: 'date-time' }, value: { type: 'number' } } },
        overall: { type: 'object', properties: { delta: { type: 'number', nullable: true }, percentChange: { type: 'number', nullable: true } } },
        changes: { type: 'object', description: 'Keys: 7d, 30d, 90d. Each includes nullable baseline, delta and percentChange.', additionalProperties: true },
        series: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, measuredAt: { type: 'string', format: 'date-time' }, value: { type: 'number' } } } },
      },
    },
  })
  statistics(
    @CurrentUser() actor: UserActor,
    @Query({ schema: bodyMeasurementStatisticsQuerySchema })
    query: BodyMeasurementStatisticsQueryDto,
  ) {
    return this.statisticsService.getStatistics(actor.id, query);
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
