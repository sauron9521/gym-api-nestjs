import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

describe('Private API response headers (AppModule + PostgreSQL)', () => {
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

  it.each(['/users/me', '/workouts', '/trainer-athletes', '/training-programs', '/body-measurements'])(
    'prevents caching private guard failures on %s',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.status).toBe(401);
      expect(response.headers['cache-control']).toBe('no-store');
    },
  );

  it('prevents caching the mixed-visibility public exercises listing', async () => {
    const response = await request(app.getHttpServer()).get('/exercises');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('keeps public liveness cache policy unchanged', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBeUndefined();
  });
});
