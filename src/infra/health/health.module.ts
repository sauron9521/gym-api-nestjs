import { Module } from '@nestjs/common';
import { PrismaModule } from '#src/infra/database/index';
import { RateLimitStorageModule } from '#src/common/rate-limit/rate-limit-storage.module';
import { HealthController } from './health.controller.js';

@Module({
  imports: [PrismaModule, RateLimitStorageModule],
  controllers: [HealthController],
})
export class HealthModule {}
