import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getRequestId,
  RequestContextMiddleware,
} from './request-context.middleware.js';

describe('RequestContextMiddleware', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates safe request IDs and does not log secrets or raw URLs', () => {
    const log = vi.spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    const request = {
      method: 'POST',
      route: { path: '/auth/login' },
      originalUrl: '/auth/login?token=SECRET_QUERY',
      headers: {
        'x-request-id': 'forged-client-id',
        authorization: 'Bearer SECRET',
      },
    } as unknown as Request;

    const emitter = new EventEmitter();
    const headers = new Map<string, string>();
    const response = Object.assign(emitter, {
      setHeader: (name: string, value: string) => {
        headers.set(name, value);
      },
      statusCode: 401,
    }) as unknown as Response;

    const next = vi.fn() as NextFunction;
    new RequestContextMiddleware().use(request, response, next);

    const id = getRequestId(request);
    expect(next).toHaveBeenCalledOnce();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(headers.get('X-Request-ID')).toBe(id);
    expect(id).not.toBe('forged-client-id');

    emitter.emit('finish');
    expect(log).toHaveBeenCalledOnce();
    const metadata = log.mock.calls[0]?.[1];

    expect(metadata).toMatchObject({
      event: 'http.request.completed',
      requestId: id,
      method: 'POST',
      route: '/auth/login',
      statusCode: 401,
    });
    expect(JSON.stringify(metadata)).not.toContain('SECRET');
    expect(JSON.stringify(metadata)).not.toContain('forged-client-id');
  });
});
