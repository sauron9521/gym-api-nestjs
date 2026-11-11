import { createHash, timingSafeEqual } from 'node:crypto';

import { Public } from '@nestjs/authentication';
import {
  Controller, Get, Header, Inject, NotFoundException, Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import type { AppConfigService } from '#src/common/config/app-config.types';
import { HttpMetricsRegistry } from './http-metrics.registry.js';

function validMetricsToken(candidate: unknown, secret: string): boolean {
  if (typeof candidate !== 'string') return false;
  // Hash both values to avoid variable-length timing and non-ASCII pitfalls.
  const actual = createHash('sha256').update(candidate, 'utf8').digest();
  const expected = createHash('sha256').update(secret, 'utf8').digest();
  return timingSafeEqual(actual, expected);
}

/**
 * No public telemetry: disabled unless explicitly opted in, and even then
 * every scrape requires a high-entropy token. Configure reverse proxies to
 * deny this path; production Compose binds the API port to host loopback.
 */
@Public()
@SkipThrottle()
@ApiExcludeController()
@Controller('internal')
export class HttpMetricsController {
  constructor(
    @Inject(ConfigService) private readonly config: AppConfigService,
    private readonly registry: HttpMetricsRegistry,
  ) {}

  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(@Req() request: Request): string {
    const enabled = this.config.get('HTTP_METRICS_ENABLED');
    const secret = this.config.get('HTTP_METRICS_TOKEN');
    // Fail with an indistinguishable 404 for disabled/unauthorized access.
    if (enabled !== true || !secret ||
        !validMetricsToken(request.headers['x-metrics-token'], secret)) {
      throw new NotFoundException();
    }
    return this.registry.render();
  }
}
