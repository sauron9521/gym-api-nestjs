import { Public } from '@nestjs/authentication';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../database/index.js';

/** Liveness is dependency-free; readiness checks PostgreSQL safely. */
@Public()
@SkipThrottle()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  liveness() {
    return { status: 'ok' as const };
  }

  @Get('ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' as const };
    } catch {
      throw new ServiceUnavailableException('Service unavailable');
    }
  }
}
