import { Module } from '@nestjs/common';
import { PrismaModule } from '#src/infra/database/index';
import { HealthController } from './health.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
})
export class HealthModule {}
