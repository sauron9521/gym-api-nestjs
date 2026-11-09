import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { Prisma } from '../src/infra/database/generated/prisma/client.js';

@Controller('__error-contract')
class ErrorFixtureController {
  @Get('validation')
  validation() {
    throw new BadRequestException(['email must be valid', 'password is required']);
  }

  @Get('business')
  business() {
    throw new ConflictException('Only active assignments can be completed.');
  }

  @Get('unique')
  unique() {
    throw new Prisma.PrismaClientKnownRequestError(
      'SECRET_SQL: INSERT INTO users ... email=private@example.test',
      {
        code: 'P2002',
        clientVersion: '7.10.1',
        meta: { target: ['email'], token: 'SECRET_DB_META' },
      },
    );
  }

  @Get('foreign-key')
  foreignKey() {
    throw new Prisma.PrismaClientKnownRequestError(
      'SECRET_SQL: FOREIGN KEY failure',
      { code: 'P2003', clientVersion: '7.10.1' },
    );
  }

  @Get('missing')
  missing() {
    throw new Prisma.PrismaClientKnownRequestError(
      'SECRET_SQL: RECORD NOT FOUND',
      { code: 'P2025', clientVersion: '7.10.1' },
    );
  }

  @Get('prisma-unknown')
  prismaUnknown() {
    throw new Prisma.PrismaClientKnownRequestError(
      'SECRET_SQL: unexpected failure',
      { code: 'P2010', clientVersion: '7.10.1' },
    );
  }

  @Get('unexpected')
  unexpected() {
    throw new Error('SECRET_INTERNAL_ERROR');
  }

  @Get('service-unavailable')
  unavailable() {
    throw new ServiceUnavailableException('sensitive DB credentials, do not expose');
  }

  @Get('server-http')
  serverHttp() {
    throw new HttpException('SECRET_INTERNAL_HTTP', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

describe('API exception filter (HTTP contract)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ErrorFixtureController],
      providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('preserves validation arrays and HTTP status', async () => {
    const response = await request(app.getHttpServer()).get('/__error-contract/validation');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: ['email must be valid', 'password is required'],
    });
    expect(response.body.error).toBe('Bad Request');
  });

  it('preserves existing business messages', async () => {
    const response = await request(app.getHttpServer()).get('/__error-contract/business');
    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Only active assignments can be completed.');
    expect(response.body.code).toBe('CONFLICT');
  });

  it.each([
    ['unique', 409, 'UNIQUE_CONSTRAINT_CONFLICT', 'Resource already exists'],
    ['foreign-key', 409, 'FOREIGN_KEY_CONFLICT', 'Resource relationship constraint failed'],
    ['missing', 404, 'RESOURCE_NOT_FOUND', 'Resource not found'],
  ])('maps Prisma %s safely', async (route, statusCode, code, message) => {
    const response = await request(app.getHttpServer()).get('/__error-contract/' + route);
    expect(response.status).toBe(statusCode);
    expect(response.body).toMatchObject({ statusCode, code, message });
    const json = JSON.stringify(response.body);
    expect(json).not.toContain('SECRET_SQL');
    expect(json).not.toContain('SECRET_DB_META');
    expect(json).not.toContain('private@example.test');
    expect(json).not.toContain('P20');
  });

  it('preserves 503 for readiness failure and hides sensitive details', async () => {
    const response = await request(app.getHttpServer())
      .get('/__error-contract/service-unavailable');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service unavailable',
    });
    expect(JSON.stringify(response.body)).not.toContain('sensitive DB');
  });

  it.each(['prisma-unknown', 'unexpected', 'server-http'])(
    'hides details of unhandled %s failures',
    async (route) => {
      const response = await request(app.getHttpServer()).get('/__error-contract/' + route);
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      });
      expect(JSON.stringify(response.body)).not.toMatch(/SECRET_/);
    },
  );

  it.each([
    'validation',
    'business',
    'unique',
    'foreign-key',
    'missing',
    'prisma-unknown',
    'unexpected',
    'service-unavailable',
    'server-http',
  ])('sets no-store for every API error type: %s', async (route) => {
    const response = await request(app.getHttpServer())
      .get('/__error-contract/' + route);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns a server-generated request ID in body and header', async () => {
    const forged = randomUUID();
    const first = await request(app.getHttpServer())
      .get('/__error-contract/business')
      .set('X-Request-ID', forged);
    const second = await request(app.getHttpServer())
      .get('/__error-contract/business');

    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(first.body.requestId).toMatch(uuid);
    expect(first.headers['x-request-id']).toBe(first.body.requestId);
    expect(first.body.requestId).not.toBe(forged);
    expect(first.body.requestId).not.toBe(second.body.requestId);
    expect(Number.isNaN(Date.parse(first.body.timestamp))).toBe(false);
  });
});
