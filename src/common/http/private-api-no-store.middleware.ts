import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Private and mixed-visibility API resources must not be cached across users.
 * Runs before authentication guards, validation and controller interceptors.
 */
const SENSITIVE_API_ROOTS = new Set([
  'users',
  'workouts',
  'body-measurements',
  'trainer-athletes',
  'training-programs',
  'exercises',
  'avatars',
]);

@Injectable()
export class PrivateApiNoStoreMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const root = request.path.split('/', 3)[1]?.toLowerCase();
    if (root && SENSITIVE_API_ROOTS.has(root)) {
      response.setHeader('Cache-Control', 'no-store');
    }

    next();
  }
}
