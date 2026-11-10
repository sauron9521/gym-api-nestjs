import { randomUUID } from 'node:crypto';

import { ServiceUnavailableException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DistributedThrottlerStorage } from '../src/common/rate-limit/distributed-throttler.storage.js';
import { PrismaService } from '../src/infra/database/index.js';
import { HealthController } from '../src/infra/health/health.controller.js';

const redisUrl = process.env.TEST_REDIS_URL;
const redisDescribe = redisUrl ? describe : describe.skip;

redisDescribe('Redis rate-limit health state observability (real HTTP + Redis)', () => {
  let app: INestApplication;
  let storage: DistributedThrottlerStorage;
  let redis: Redis;
  const logger = { warn: vi.fn(), log: vi.fn() };
  const key = `secret-account-${randomUUID()}@example.test`;
  const sensitiveToken = 'private-reset-token-for-log-redaction';

  beforeAll(async () => {
    storage = new DistributedThrottlerStorage({
      get: (name: string) => name === 'REDIS_URL' ? redisUrl : undefined,
    } as never);
    (storage as unknown as { logger: typeof logger }).logger = logger;

    // HealthController's database dependency is deterministic here; Redis
    // is the real integration dependency under test.
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: { $queryRaw: vi.fn(async () => [{ one: 1 }]) } },
        { provide: DistributedThrottlerStorage, useValue: storage },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const client = (storage as unknown as { redis: Redis | null }).redis;
    if (!client) throw new Error('Redis must be enabled for this suite');
    redis = client;
  }, 20_000);

  afterAll(async () => {
    await app?.close();
    if (!app && storage) await storage.onApplicationShutdown();
  });

  it('logs one safe outage and recovery transition, including health readiness and counter preservation', async () => {
    await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();

    const first = await storage.increment(key, 60_000, 2, 0, 'private-account');
    expect(first.isBlocked).toBe(false);

    // Disconnect *only this test client*, not the shared CI Redis service.
    redis.disconnect();
    await vi.waitFor(() => {
      expect(redis.status).toBe('end');
    }, { timeout: 5_000, interval: 25 });

    // Simulate a driver error that contains sensitive details. Neither the
    // Error message nor the key nor the connection URL may reach the logger.
    redis.emit('error', new Error(`${redisUrl} ${key} ${sensitiveToken}`));
    const offline = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(offline.body.message).toBe('Service unavailable');
    await expect(storage.increment(key + sensitiveToken, 60_000, 2, 0, 'private-account'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(storage.checkReadiness()).resolves.toBe(false);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith({
      event: 'RATE_LIMIT_REDIS_UNAVAILABLE',
      component: 'rate_limiting',
      backend: 'redis',
    });
    expect(logger.log).not.toHaveBeenCalled();

    await redis.connect();
    await request(app.getHttpServer()).get('/health/ready').expect(200);
    await expect(storage.checkReadiness()).resolves.toBe(true);
    const second = await storage.increment(key, 60_000, 2, 0, 'private-account');
    expect(second.isBlocked).toBe(false);
    expect(second.totalHits).toBe(2);
    const third = await storage.increment(key, 60_000, 2, 0, 'private-account');
    expect(third.isBlocked).toBe(true);
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith({
      event: 'RATE_LIMIT_REDIS_RECOVERED',
      component: 'rate_limiting',
      backend: 'redis',
    });

    for (const sensitive of [redisUrl!, key, sensitiveToken]) {
      const logged = JSON.stringify([logger.warn.mock.calls, logger.log.mock.calls]);
      expect(logged).not.toContain(sensitive);
      expect(JSON.stringify(offline.body)).not.toContain(sensitive);
    }
  }, 30_000);
});
