import { Public } from '@nestjs/authentication';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';

import { PrismaService } from '#src/infra/database/index';
import { DistributedThrottlerStorage } from '#src/common/rate-limit/distributed-throttler.storage';

/** Liveness is dependency-free; readiness checks PostgreSQL safely. */
@Public()
@SkipThrottle()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly throttleStorage: DistributedThrottlerStorage,
  ) {}

  @Get('live')
  liveness() {
    return { status: 'ok' as const };
  }

  @Get('ready')
  async readiness() {
    try {
      const [database, throttling] = await Promise.all([
        this.prisma.$queryRaw`SELECT 1`,
        this.throttleStorage.checkReadiness(),
      ]);
      if (!database || !throttling) {
        throw new Error('Dependency not ready');
      }
      return { status: 'ok' as const };
    } catch {
      throw new ServiceUnavailableException('Service unavailable');
    }
  }
}
