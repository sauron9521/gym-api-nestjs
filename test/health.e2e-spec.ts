import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { useTestDatabase } from './utility/test-db-helper.js';

describe('Health and request correlation (HTTP + PostgreSQL)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    useTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  }, 20_000);

  it('serves public liveness and skips throttling for probes', async () => {
    for (let i = 0; i < 12; i++) {
      const response = await request(app.getHttpServer())
        .get('/health/live')
        .expect(200);
      expect(response.body).toEqual({ status: 'ok' });
      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
  });

  it('checks PostgreSQL readiness without authentication', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('uses the same server-generated ID for error header and body', async () => {
    const response = await request(app.getHttpServer())
      .get('/')
      .set('X-Request-ID', 'forged-id');
    expect([401, 403]).toContain(response.status);
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    expect(response.body.requestId).not.toBe('forged-id');
  });

  it('returns unique request IDs for separate successful requests', async () => {
    const first = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);
    const second = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });
});
