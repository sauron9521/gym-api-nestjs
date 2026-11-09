import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Sets no-store before guards, validation pipes and controllers run.
 * Restrict the policy to the /auth boundary (not /authentication or /users).
 * Express request.path excludes the query string and is not logged.
 */
@Injectable()
export class AuthNoStoreMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    if (/^\/auth(?:\/|$)/i.test(request.path)) {
      response.setHeader('Cache-Control', 'no-store');
    }

    next();
  }
}
