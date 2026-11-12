import { EventEmitter } from 'node:events';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '#prisma/client';

import { HttpMetricsRegistry } from '../http-metrics/http-metrics.registry.js';
import {
  getRequestId,
  RequestContextMiddleware,
} from '../request-context/request-context.middleware.js';
import { ApiExceptionFilter } from './api-exception.filter.js';

describe('ApiExceptionFilter', () => {
  const filter = new ApiExceptionFilter();

  function respond(exception: unknown, request: Request = {} as Request) {
    const setHeader = vi.fn();
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const response = { setHeader, status, json } as unknown as Response;
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);

    expect(json).toHaveBeenCalledOnce();
    const body = json.mock.calls[0]![0] as {
      statusCode: number;
      code: string;
      message: string | string[];
      requestId: string;
      timestamp: string;
      error?: string;
    };
    expect(status).toHaveBeenCalledExactlyOnceWith(body.statusCode);
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', body.requestId);
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(body.timestamp).toBe(new Date(body.timestamp).toISOString());

    return { body, setHeader, status, json };
  }

  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('PRIVATE SQL PARAMS SECRET_TOKEN', {
      code,
      clientVersion: '7.10.1',
      meta: { target: 'private_email', secret: 'PRIVATE_METADATA' },
    });

  afterEach(() => vi.restoreAllMocks());

  it('returns a stable client error envelope with validation messages', () => {
    const { body } = respond(new BadRequestException({
      statusCode: 400,
      message: ['title must be a string', 'durationWeeks must be positive'],
      error: 'Bad Request',
    }));
    expect(body).toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: ['title must be a string', 'durationWeeks must be positive'],
      error: 'Bad Request',
    });
    expect(body).not.toHaveProperty('stack');
  });

  it.each([
    { exception: new ForbiddenException('Not allowed'), status: 403, code: 'FORBIDDEN' },
    { exception: new ConflictException('Already exists'), status: 409, code: 'CONFLICT' },
    { exception: new HttpException('Missing', HttpStatus.NOT_FOUND), status: 404, code: 'NOT_FOUND' },
    { exception: new HttpException('Authentication required', HttpStatus.UNAUTHORIZED), status: 401, code: 'UNAUTHORIZED' },
    { exception: new HttpException('Slow down', HttpStatus.TOO_MANY_REQUESTS), status: 429, code: 'TOO_MANY_REQUESTS' },
    { exception: new HttpException('Unsupported content', HttpStatus.UNSUPPORTED_MEDIA_TYPE), status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' },
    { exception: new HttpException('Method disabled', HttpStatus.METHOD_NOT_ALLOWED), status: 405, code: 'METHOD_NOT_ALLOWED' },
    { exception: new HttpException('Invalid payload', HttpStatus.UNPROCESSABLE_ENTITY), status: 422, code: 'UNPROCESSABLE_ENTITY' },
    { exception: new HttpException('Oversized', HttpStatus.PAYLOAD_TOO_LARGE), status: 413, code: 'PAYLOAD_TOO_LARGE' },
  ])('maps HTTP $status without changing its status', ({ exception, status, code }) => {
    expect(respond(exception).body).toMatchObject({
      statusCode: status,
      code,
    });
  });

  it('falls back to HTTP_<status> for custom client error codes', () => {
    const { body } = respond(new HttpException('I am a teapot', 418));
    expect(body).toMatchObject({
      statusCode: 418,
      code: 'HTTP_418',
      message: 'I am a teapot',
    });
  });

  it('uses a plain-string exception response as the message', () => {
    const { body } = respond(new HttpException('Custom error string', 400));
    expect(body.message).toBe('Custom error string');
    expect(body).not.toHaveProperty('error');
  });

  it('ignores malformed non-string response messages and error fields', () => {
    const { body } = respond(new HttpException({
      statusCode: 400,
      message: { token: 'SECRET_TOKEN' },
      error: ['private', 'details'],
    }, 400));
    expect(typeof body.message).toBe('string');
    expect(JSON.stringify(body)).not.toContain('SECRET_TOKEN');
    expect(body).not.toHaveProperty('error');
  });

  it.each([
    { code: 'P2002', statusCode: 409, apiCode: 'UNIQUE_CONSTRAINT_CONFLICT', message: 'Resource already exists' },
    { code: 'P2003', statusCode: 409, apiCode: 'FOREIGN_KEY_CONFLICT', message: 'Resource relationship constraint failed' },
    { code: 'P2025', statusCode: 404, apiCode: 'RESOURCE_NOT_FOUND', message: 'Resource not found' },
  ])('maps Prisma $code without exposing SQL or metadata', ({ code, statusCode, apiCode, message }) => {
    const { body } = respond(prismaError(code));
    expect(body).toMatchObject({
      statusCode,
      code: apiCode,
      message,
    });
    expect(body).not.toHaveProperty('error');
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE|SECRET_TOKEN|private_email/);
  });

  it('maps unexpected Prisma errors to 500 and logs only a safe code plus request ID', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { body } = respond(prismaError('P2010'));
    expect(body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Unhandled API failure (PRISMA_P2010), requestId=' + body.requestId,
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|SECRET_TOKEN|private_email/);
  });

  it('does not expose HTTP 500 payloads or unhandled exception contents', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const first = respond(new HttpException({
      message: 'PRIVATE_EXCEPTION',
      error: 'PRIVATE_ERROR',
    }, 500)).body;
    const second = respond(new Error('PRIVATE_STACK_TRACE')).body;

    for (const body of [first, second]) {
      expect(body).toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      });
      expect(JSON.stringify(body)).not.toMatch(/PRIVATE/);
    }
    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE/);
  });

  it('returns a sanitized 503 while retaining the useful status', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { body } = respond(new ServiceUnavailableException('PRIVATE_DB_HOST'));
    expect(body).toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service unavailable',
    });
    expect(JSON.stringify(body)).not.toContain('PRIVATE_DB_HOST');
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Unhandled API failure (HTTP_503), requestId=' + body.requestId,
    );
  });

  it('uses a new server-generated ID instead of an untrusted client header', () => {
    const request = {
      headers: { 'x-request-id': 'forged-client-id' },
    } as unknown as Request;
    const { body } = respond(new BadRequestException('Bad request'), request);
    expect(body.requestId).not.toBe('forged-client-id');
  });

  it('preserves the server-generated request ID from request-context middleware', () => {
    const request = {
      method: 'GET',
      path: '/health/live',
      headers: { 'x-request-id': 'forged-client-id' },
    } as unknown as Request;
    const emitter = Object.assign(new EventEmitter(), {
      setHeader: vi.fn(),
      statusCode: 400,
    }) as unknown as Response;

    new RequestContextMiddleware(new HttpMetricsRegistry()).use(
      request, emitter, vi.fn(),
    );
    const trustedId = getRequestId(request);
    expect(trustedId).toBeDefined();

    const { body } = respond(new BadRequestException('Invalid'), request);
    expect(body.requestId).toBe(trustedId);
    expect(body.requestId).not.toBe('forged-client-id');
  });

  it('converts arbitrary thrown values to safe internal errors', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { body } = respond('PRIVATE_STRING_ERROR');
    expect(body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });
    expect(JSON.stringify(body)).not.toContain('PRIVATE_STRING_ERROR');
    expect(log).toHaveBeenCalledOnce();
  });
});
