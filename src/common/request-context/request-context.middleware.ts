import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

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

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = randomUUID();
    (request as RequestWithId)[REQUEST_ID] = requestId;
    response.setHeader('X-Request-ID', requestId);
    const start = process.hrtime.bigint();

    response.once('finish', () => {
      const path: unknown = request.route?.path;
      const route = typeof path === 'string' ? path : 'unmatched';

      this.logger.log('HTTP request completed', {
        event: 'http.request.completed',
        requestId,
        method: request.method,
        route,
        statusCode: response.statusCode,
        durationMs: Math.round(
          (Number(process.hrtime.bigint() - start) / 1_000_000) * 100,
        ) / 100,
      });
    });

    next();
  }
}
