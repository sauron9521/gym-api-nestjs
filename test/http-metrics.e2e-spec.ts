import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { useTestDatabase } from './utility/test-db-helper.js';

const TOKEN = 'm'.repeat(43);
const savedEnabled = process.env.HTTP_METRICS_ENABLED;
const savedToken = process.env.HTTP_METRICS_TOKEN;

describe('HTTP metrics (real Nest middleware, controller and test DB)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    useTestDatabase();
    process.env.HTTP_METRICS_ENABLED = 'true';
    process.env.HTTP_METRICS_TOKEN = TOKEN;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    if (savedEnabled === undefined) delete process.env.HTTP_METRICS_ENABLED;
    else process.env.HTTP_METRICS_ENABLED = savedEnabled;
    if (savedToken === undefined) delete process.env.HTTP_METRICS_TOKEN;
    else process.env.HTTP_METRICS_TOKEN = savedToken;
  }, 20_000);

  async function metrics(): Promise<string> {
    const result = await request(app.getHttpServer())
      .get('/internal/metrics')
      .set('Authorization', 'Bearer ' + TOKEN)
      .expect(200);
    expect(result.headers['content-type']).toContain('text/plain');
    expect(result.headers['cache-control']).toBe('no-store');
    return result.text;
  }

  function sample(text: string, name: string): number {
    const line = text.split('\n').find(row => row.startsWith(name + ' '));
    if (!line) throw new Error('Missing metric sample');
    return Number(line.slice(name.length + 1));
  }

  it('hides the metrics endpoint from anonymous and invalid-token users', async () => {
    await request(app.getHttpServer()).get('/internal/metrics').expect(404);
    await request(app.getHttpServer())
      .get('/internal/metrics').set('Authorization', 'Bearer not-a-token')
      .expect(404);
    await request(app.getHttpServer())
      .get('/internal/metrics').set('Authorization', 'Bearer ' + TOKEN)
      .expect(200);
  });

  it('counts real completed responses including unauthenticated failures', async () => {
    const before = await metrics();
    const old2xx = sample(before,
      'gym_api_http_requests_total{status_class="2xx"}');
    const old4xx = sample(before,
      'gym_api_http_requests_total{status_class="4xx"}');
    const oldDuration = sample(before, 'gym_api_http_request_duration_seconds_count');

    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/').expect(404);
    const unauthorized = await request(app.getHttpServer()).get('/users/me');
    expect([401, 403]).toContain(unauthorized.status);

    const after = await metrics();
    expect(sample(after,
      'gym_api_http_requests_total{status_class="2xx"}') - old2xx).toBe(1);
    expect(sample(after,
      'gym_api_http_requests_total{status_class="4xx"}') - old4xx).toBe(2);
    expect(sample(after, 'gym_api_http_request_duration_seconds_count') - oldDuration)
      .toBe(3);

    // Neither the public response nor the metrics response contains request URLs,
    // query tokens, identities or request IDs as Prometheus label dimensions.
    expect(after).not.toMatch(/path=|route=|method=|request_id=|user_id=|jwt=|ip=/i);
    expect(after).not.toContain(TOKEN);
  });

  it('does not count Prometheus scrapes or create new label dimensions', async () => {
    const before = await metrics();
    for (let i = 0; i < 5; i++) await metrics();
    const after = await metrics();
    expect(sample(after, 'gym_api_http_request_duration_seconds_count'))
      .toBe(sample(before, 'gym_api_http_request_duration_seconds_count'));
    expect(after.match(/^gym_api_http_requests_total\{/gm)).toHaveLength(5);
    expect(after.match(/^gym_api_http_request_duration_seconds_bucket\{/gm))
      .toHaveLength(12);
  });
});
