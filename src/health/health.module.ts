import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/index.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
})
export class HealthModule {}
