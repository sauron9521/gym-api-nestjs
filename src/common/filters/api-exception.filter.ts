import { randomUUID } from 'node:crypto';

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getRequestId } from '../request-context/request-context.middleware.js';

import { Prisma } from '../../infra/database/generated/prisma/client.js';

type ErrorBody = {
  statusCode: number;
  code: string;
  message: string | string[];
  requestId: string;
  timestamp: string;
  error?: string;
};

const HTTP_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

/**
 * Converts HTTP and unhandled Prisma exceptions to an API-safe JSON shape.
 *
 * Domain services keep responsibility for business-specific exceptions.
 * Never return a raw Prisma error, query, stack or metadata to the client.
 */
@Injectable()
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const requestId = getRequestId(request) ?? randomUUID();
    const timestamp = new Date().toISOString();

    const mapped = this.mapException(exception, requestId);
    const body: ErrorBody = {
      statusCode: mapped.statusCode,
      code: mapped.code,
      message: mapped.message,
      requestId,
      timestamp,
      ...(mapped.error ? { error: mapped.error } : {}),
    };

    response.setHeader('X-Request-ID', requestId);
    response.status(mapped.statusCode).json(body);
  }

  private mapException(
    exception: unknown,
    requestId: string,
  ): Pick<ErrorBody, 'statusCode' | 'code' | 'message' | 'error'> {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      if (statusCode >= 500) {
        this.logUnexpected('HTTP_' + statusCode, requestId);
        if (statusCode === HttpStatus.SERVICE_UNAVAILABLE) {
          return {
            statusCode,
            code: 'SERVICE_UNAVAILABLE',
            message: 'Service unavailable',
          };
        }
        return this.internalError();
      }

      const payload: unknown = exception.getResponse();
      const content =
        typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>)
          : null;

      // Nest and StandardSchemaValidationPipe use string or string[] messages.
      // Preserve them for existing clients and business-specific tests.
      const maybeMessage = content?.['message'];
      const message =
        typeof maybeMessage === 'string' ||
        (Array.isArray(maybeMessage) && maybeMessage.every((part) => typeof part === 'string'))
          ? maybeMessage
          : typeof payload === 'string'
            ? payload
            : exception.message;

      const error = content?.['error'];
      return {
        statusCode,
        code: HTTP_CODES[statusCode] ?? 'HTTP_' + statusCode,
        message,
        ...(typeof error === 'string' ? { error } : {}),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            statusCode: HttpStatus.CONFLICT,
            code: 'UNIQUE_CONSTRAINT_CONFLICT',
            message: 'Resource already exists',
          };
        case 'P2003':
          return {
            statusCode: HttpStatus.CONFLICT,
            code: 'FOREIGN_KEY_CONFLICT',
            message: 'Resource relationship constraint failed',
          };
        case 'P2025':
          return {
            statusCode: HttpStatus.NOT_FOUND,
            code: 'RESOURCE_NOT_FOUND',
            message: 'Resource not found',
          };
        default:
          this.logUnexpected('PRISMA_' + exception.code, requestId);
          return this.internalError();
      }
    }

    this.logUnexpected('UNHANDLED_EXCEPTION', requestId);
    return this.internalError();
  }

  private internalError() {
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    };
  }

  private logUnexpected(kind: string, requestId: string): void {
    // Avoid logging raw Prisma SQL, error metadata, tokens or request bodies.
    this.logger.error('Unhandled API failure (' + kind + '), requestId=' + requestId);
  }
}
