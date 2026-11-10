import { Module } from '@nestjs/common';

import { WorkoutAnalyticsRepository } from './repositories/workout-analytics.repository.js';
import { WorkoutAnalyticsService } from './services/workout-analytics.service.js';
import { WorkoutAnalyticsController } from './controllers/workout-analytics.controller.js';

@Module({
  controllers: [WorkoutAnalyticsController],
  providers: [WorkoutAnalyticsRepository, WorkoutAnalyticsService],
})
export class WorkoutAnalyticsModule {}
