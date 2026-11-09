import { randomUUID } from 'node:crypto';

import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { DistributedThrottlerStorage } from '../src/common/rate-limit/distributed-throttler.storage.js';

const redisUrl = process.env.TEST_REDIS_URL;
const redisDescribe = redisUrl ? describe : describe.skip;

function storageForRedis(): DistributedThrottlerStorage {
  return new DistributedThrottlerStorage({
    get: (key: string) => key === 'REDIS_URL' ? redisUrl : undefined,
  } as never);
}

@Controller('distributed-rate-test')
class RedisRateTestController {
  @Get()
  get() {
    return { ok: true };
  }
}

redisDescribe('distributed throttling (Redis + HTTP)', () => {
  const storages: DistributedThrottlerStorage[] = [];
  const apps: Array<Awaited<ReturnType<typeof makeApp>>> = [];

  async function makeApp(storage: DistributedThrottlerStorage, prefix: string) {
    @Module({
      imports: [ThrottlerModule.forRoot({
        throttlers: [{ ttl: 60_000, limit: 2 }],
        storage,
        generateKey: (_ctx, tracker, throttlerName) =>
          `${prefix}:${tracker}:${throttlerName}`,
      })],
      controllers: [RedisRateTestController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    })
    class RedisRateTestModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [RedisRateTestModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
  }

  afterAll(async () => {
    for (const app of apps) await app.close();
    for (const storage of storages) await storage.onApplicationShutdown();
  });

  it('probes a working Redis connection for health readiness', async () => {
    const storage = storageForRedis();
    storages.push(storage);
    await expect(storage.checkReadiness()).resolves.toBe(true);
    await expect(storage.checkReadiness()).resolves.toBe(true);
  });

  it('shares atomic counters between two separate process-like instances', async () => {
    const [first, second] = [storageForRedis(), storageForRedis()];
    storages.push(first, second);
    const prefix = randomUUID();
    const a = await makeApp(first, prefix);
    const b = await makeApp(second, prefix);
    apps.push(a, b);

    await request(a.getHttpServer()).get('/distributed-rate-test').expect(200);
    await request(b.getHttpServer()).get('/distributed-rate-test').expect(200);
    await request(a.getHttpServer()).get('/distributed-rate-test').expect(429);
    await request(b.getHttpServer()).get('/distributed-rate-test').expect(429);
  });

  it('increments atomically across parallel requests', async () => {
    const first = storageForRedis();
    const second = storageForRedis();
    storages.push(first, second);
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 === 0 ? first : second).increment(key, 60_000, 3, 0, 'default'),
      ),
    );
    expect(results.filter((item) => !item.isBlocked)).toHaveLength(3);
    expect(Math.max(...results.map((item) => item.totalHits))).toBe(20);
  });

  it('enforces blockDuration and resets after expiration', async () => {
    const storage = storageForRedis();
    storages.push(storage);
    const key = randomUUID();
    expect((await storage.increment(key, 150, 1, 200, 'default')).isBlocked)
      .toBe(false);
    const denied = await storage.increment(key, 150, 1, 200, 'default');
    expect(denied.isBlocked).toBe(true);
    expect(denied.timeToBlockExpire).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 280));
    expect((await storage.increment(key, 150, 1, 200, 'default')).isBlocked)
      .toBe(false);
  });
});
