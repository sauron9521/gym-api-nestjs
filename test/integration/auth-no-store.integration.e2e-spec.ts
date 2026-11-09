import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

describe('Auth no-store before guards (AppModule + PostgreSQL)', () => {
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

  it('sets no-store on authentication guard rejection before controller interceptors', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/sessions');

    expect(response.status).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('also protects invalid auth requests that fail validation', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken: '' });

    expect(response.status).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('does not add no-store to unrelated health endpoints', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBeUndefined();
  });
});
