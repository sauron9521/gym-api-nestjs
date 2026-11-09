import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { PrivateApiNoStoreMiddleware } from './private-api-no-store.middleware.js';

describe('PrivateApiNoStoreMiddleware', () => {
  const middleware = new PrivateApiNoStoreMiddleware();

  function invoke(path: string) {
    const setHeader = vi.fn();
    const next = vi.fn() as NextFunction;
    middleware.use(
      { path } as Request,
      { setHeader } as unknown as Response,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
    return setHeader;
  }

  it.each([
    '/users',
    '/users/me',
    '/workouts',
    '/workouts/123',
    '/trainer-athletes',
    '/training-programs/abc',
    '/body-measurements/statistics',
    '/exercises', // Mixed guest/private library requires non-shared caching.
    '/avatars/1234.png',
    '/USERS/me',
  ])('marks sensitive path %s as no-store', (path) => {
    expect(invoke(path)).toHaveBeenCalledExactlyOnceWith(
      'Cache-Control',
      'no-store',
    );
  });

  it.each([
    '/health/live',
    '/auth/login', // Already covered by AuthNoStoreMiddleware.
    '/about',
    '/users-other',
    '/exercises-public',
    '/workoutsOther',
    '/v1/users/me',
    '/',
  ])('does not alter unrelated path %s', (path) => {
    expect(invoke(path)).not.toHaveBeenCalled();
  });
});
