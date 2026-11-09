import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { AuthNoStoreMiddleware } from '../middleware/auth-no-store.middleware.js';

describe('AuthNoStoreMiddleware', () => {
  const middleware = new AuthNoStoreMiddleware();

  function run(path: string) {
    const headers = new Map<string, string>();
    const request = { path } as Request;
    const setHeader = vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    });
    const response = { setHeader } as unknown as Response;
    const next = vi.fn() as NextFunction;

    middleware.use(request, response, next);
    expect(next).toHaveBeenCalledOnce();
    return { headers, setHeader };
  }

  it.each([
    '/auth',
    '/auth/',
    '/auth/login',
    '/auth/token/refresh',
    '/auth/sessions',
    '/AUTH/token/refresh',
  ])('sets no-store for the auth route boundary %s', (path) => {
    const { headers, setHeader } = run(path);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(setHeader).toHaveBeenCalledExactlyOnceWith(
      'Cache-Control',
      'no-store',
    );
  });

  it.each([
    '/users/me',
    '/health/live',
    '/authentication',
    '/authentic',
    '/auth-token',
    '/v1/auth/login',
  ])('leaves unrelated route %s unchanged', (path) => {
    const { headers, setHeader } = run(path);
    expect(headers.has('cache-control')).toBe(false);
    expect(setHeader).not.toHaveBeenCalled();
  });
});
