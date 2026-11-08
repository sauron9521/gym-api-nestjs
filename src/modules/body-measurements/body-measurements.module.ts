import { Module } from '@nestjs/common';

import { BodyMeasurementsController } from './body-measurements.controller.js';
import { BodyMeasurementsRepository } from './body-measurements.repository.js';
import { BodyMeasurementsService } from './body-measurements.service.js';
import { BodyMeasurementStatisticsService } from './body-measurement-statistics.service.js';
import { BodyMeasurementStatisticsRepository } from './body-measurement-statistics.repository.js';

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
