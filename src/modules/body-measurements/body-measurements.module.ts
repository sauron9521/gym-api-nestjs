import { Module } from '@nestjs/common';

import { BodyMeasurementsController } from './body-measurements.controller.js';
import { BodyMeasurementsRepository } from './repositories/body-measurements.repository.js';
import { BodyMeasurementsService } from './services/body-measurements.service.js';
import { BodyMeasurementStatisticsService } from './services/body-measurement-statistics.service.js';
import { BodyMeasurementStatisticsRepository } from './repositories/body-measurement-statistics.repository.js';

@Module({
  controllers: [BodyMeasurementsController],
  providers: [
    BodyMeasurementsRepository,
    BodyMeasurementsService,
    BodyMeasurementStatisticsRepository,
    BodyMeasurementStatisticsService,
  ],
})
export class BodyMeasurementsModule {}
