import { Module } from '@nestjs/common';

import { BodyMeasurementsController } from './body-measurements.controller.js';
import { BodyMeasurementsRepository } from './body-measurements.repository.js';
import { BodyMeasurementsService } from './body-measurements.service.js';

@Module({
  controllers: [BodyMeasurementsController],
  providers: [BodyMeasurementsRepository, BodyMeasurementsService],
})
export class BodyMeasurementsModule {}
