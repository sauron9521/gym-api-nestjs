import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { HttpMetricsRegistry } from '../http-metrics/http-metrics.registry.js';

/** Symbols prevent clients from overriding server-generated correlation IDs. */
const REQUEST_ID = Symbol('gym-api.request-id');
type RequestWithId = Request & { [REQUEST_ID]?: string };

export function getRequestId(request: Request): string | undefined {
  return (request as RequestWithId)[REQUEST_ID];
}

/** Runs before authentication guards and logs only safe request metadata. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestContextMiddleware.name);

  constructor(private readonly httpMetrics: HttpMetricsRegistry) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = randomUUID();
    (request as RequestWithId)[REQUEST_ID] = requestId;
    response.setHeader('X-Request-ID', requestId);
    const start = process.hrtime.bigint();
    // Instrument the entire request lifetime without retaining request details.
    // Never count our own scraper as traffic or as an aborted response.
    const excludeMetrics = request.path === '/internal/metrics';
    if (!excludeMetrics) this.httpMetrics.requestStarted();
    let settled = false;

    response.once('finish', () => {
      if (settled) return;
      settled = true;
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      if (!excludeMetrics) {
        this.httpMetrics.requestCompleted(response.statusCode, durationSeconds);
      }
      const path: unknown = request.route?.path;
      const route = typeof path === 'string' ? path : 'unmatched';

      this.logger.log('HTTP request completed', {
        event: 'http.request.completed',
        requestId,
        method: request.method,
        route,
        statusCode: response.statusCode,
        durationMs: Math.round(durationSeconds * 100_000) / 100,
      });
    });

    // "close" can also fire AFTER "finish" for normal requests. In that
    // case it is not an abort. Incomplete responses have no HTTP status.
    response.once('close', () => {
      if (settled) return;
      settled = true;
      if (!excludeMetrics) this.httpMetrics.requestAborted();
      const path: unknown = request.route?.path;
      const route = typeof path === 'string' ? path : 'unmatched';
      this.logger.warn('HTTP response closed before finish', {
        event: 'http.request.aborted',
        requestId,
        method: request.method,
        route,
        durationMs: Math.round(
          (Number(process.hrtime.bigint() - start) / 1_000_000) * 100,
        ) / 100,
      });
    });

    next();
  }
}
