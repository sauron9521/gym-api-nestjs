import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getRequestId,
  RequestContextMiddleware,
} from './request-context.middleware.js';
import { HttpMetricsRegistry } from '../http-metrics/http-metrics.registry.js';

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
    const registry = new HttpMetricsRegistry();
    new RequestContextMiddleware(registry).use(request, response, next);

    const id = getRequestId(request);
    expect(next).toHaveBeenCalledOnce();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(headers.get('X-Request-ID')).toBe(id);
    expect(id).not.toBe('forged-client-id');

    emitter.emit('finish');
    expect(registry.render()).toContain('gym_api_http_requests_total{status_class="4xx"} 1');
    expect(registry.render()).toContain('gym_api_http_request_duration_seconds_count 1');
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


  it('counts disconnect only when close precedes finish; finish then close is completed once', () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const registry = new HttpMetricsRegistry();
    const middleware = new RequestContextMiddleware(registry);

    const request = {
      path: '/workouts/secret?auth=SECRET_QUERY',
      method: 'POST',
      originalUrl: '/workouts/secret?auth=SECRET_QUERY',
      route: { path: '/workouts/:id' },
      headers: { authorization: 'Bearer SENSITIVE_TOKEN' },
    } as unknown as Request;
    const open = () => Object.assign(new EventEmitter(), {
      setHeader: vi.fn(), statusCode: 200,
    }) as unknown as Response;

    const responseAborted = open();
    middleware.use(request, responseAborted, vi.fn());
    expect(registry.render()).toContain('gym_api_http_requests_in_flight 1');
    responseAborted.emit('close');
    responseAborted.emit('finish');
    responseAborted.emit('close');
    expect(registry.render()).toContain('gym_api_http_requests_started_total 1');
    expect(registry.render()).toContain('gym_api_http_requests_aborted_total 1');
    expect(registry.render()).toContain('gym_api_http_requests_in_flight 0');
    expect(registry.render()).toContain('gym_api_http_request_duration_seconds_count 0');
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[1]).toMatchObject({
      event: 'http.request.aborted', method: 'POST', route: '/workouts/:id',
    });
    expect(JSON.stringify(warn.mock.calls[0]?.[1])).not.toMatch(/SECRET|Bearer|SENSITIVE/);

    const responseCompleted = open();
    middleware.use(request, responseCompleted, vi.fn());
    responseCompleted.emit('finish');
    responseCompleted.emit('close');
    responseCompleted.emit('finish');
    expect(registry.render()).toContain('gym_api_http_requests_started_total 2');
    expect(registry.render()).toContain('gym_api_http_requests_aborted_total 1');
    expect(registry.render()).toContain('gym_api_http_request_duration_seconds_count 1');
    expect(registry.render()).toContain('gym_api_http_requests_in_flight 0');
    expect(log).toHaveBeenCalledOnce();
  });

  it('does not count internal metric scrapes even on abort', () => {
    const registry = new HttpMetricsRegistry();
    const middleware = new RequestContextMiddleware(registry);
    for (const done of ['finish', 'close']) {
      const response = Object.assign(new EventEmitter(), {
        setHeader: vi.fn(), statusCode: 200,
      }) as unknown as Response;
      middleware.use({
        path: '/internal/metrics', method: 'GET', route: { path: '/internal/metrics' },
      } as unknown as Request, response, vi.fn());
      response.emit(done);
    }
    expect(registry.render()).toContain('gym_api_http_requests_started_total 0');
    expect(registry.render()).toContain('gym_api_http_requests_aborted_total 0');
    expect(registry.render()).toContain('gym_api_http_requests_in_flight 0');
    expect(registry.render()).toContain('gym_api_http_request_duration_seconds_count 0');
  });

});
