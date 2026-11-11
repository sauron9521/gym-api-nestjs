import { once } from 'node:events';
import { createServer, get } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';

import { HttpMetricsRegistry } from '../src/common/http-metrics/http-metrics.registry.js';
import { RequestContextMiddleware } from '../src/common/request-context/request-context.middleware.js';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
    // AppModule evaluates ConfigModule.forRoot() at import time, not at
    // Test.createTestingModule().compile(). Import only after configuring env.
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const config = app.get(ConfigService);
    expect(config.get('HTTP_METRICS_ENABLED')).toBe(true);
    expect(config.get('HTTP_METRICS_TOKEN')).toBe(TOKEN);
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


  it('records a real TCP client disconnect without inventing a completed HTTP status', async () => {
    const registry = new HttpMetricsRegistry();
    const middleware = new RequestContextMiddleware(registry);
    let notifyClose: (() => void) | undefined;
    const closeObserved = new Promise<void>((resolve) => {
      notifyClose = resolve;
    });
    const server = createServer((incoming, outgoing) => {
      middleware.use(
        incoming as unknown as Request,
        outgoing as unknown as Response,
        () => {
          outgoing.once('close', () => notifyClose?.());
          outgoing.writeHead(200, { 'content-type': 'text/plain' });
          outgoing.write('partial'); // deliberately never call end()
        },
      );
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Missing TCP port');

      await new Promise<void>((resolve, reject) => {
        const client = get({
          host: '127.0.0.1', port: addr.port,
          path: '/never-completes?private=DO_NOT_EXPORT',
          agent: false,
        }, (incoming) => {
          incoming.on('error', () => undefined);
          client.destroy(); // real socket close before HTTP response finish
          resolve();
        });
        client.once('error', reject);
      });
      await Promise.race([
        closeObserved,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Server did not observe disconnect')), 4000);
        }),
      ]);
      const snapshot = registry.render();
      expect(sample(snapshot, 'gym_api_http_requests_started_total')).toBe(1);
      expect(sample(snapshot, 'gym_api_http_requests_aborted_total')).toBe(1);
      expect(sample(snapshot, 'gym_api_http_requests_in_flight')).toBe(0);
      expect(sample(snapshot, 'gym_api_http_request_duration_seconds_count')).toBe(0);
      expect(sample(snapshot, 'gym_api_http_requests_total{status_class="2xx"}')).toBe(0);
      expect(snapshot).not.toContain('DO_NOT_EXPORT');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

});
