import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { DistributedThrottlerStorage } from './distributed-throttler.storage.js';

function withRedis(url?: string): DistributedThrottlerStorage {
  return new DistributedThrottlerStorage({
    get: (key: string) => key === 'REDIS_URL' ? url : undefined,
  } as never);
}

describe('DistributedThrottlerStorage', () => {
  it('reports readiness with the local in-memory throttler', async () => {
    const storage = withRedis();
    try {
      await expect(storage.checkReadiness()).resolves.toBe(true);
    } finally {
      await storage.onApplicationShutdown();
    }
  });

  it('returns false without exposing connection errors when Redis is offline', async () => {
    const storage = withRedis('redis://127.0.0.1:1');
    try {
      await expect(storage.checkReadiness()).resolves.toBe(false);
    } finally {
      await storage.onApplicationShutdown();
    }
  });

  it('logs one structured outage event and never logs Redis errors or account identifiers', async () => {
    const redisUrl = 'redis://:private-password@127.0.0.1:1';
    const email = 'sensitive-member@example.test';
    const token = 'secret-reset-token';
    const storage = withRedis(redisUrl);
    const logger = { warn: vi.fn(), log: vi.fn() };
    (storage as unknown as { logger: typeof logger }).logger = logger;
    try {
      const redis = (storage as unknown as {
        redis: { emit(event: string, error: Error): void };
      }).redis;

      // The raw Error deliberately includes secrets. Only fixed event fields
      // may reach the logger; repeated failures must not flood production logs.
      redis.emit('error', new Error(`${redisUrl} ${email} ${token}`));
      redis.emit('error', new Error(`another failure: ${email}`));
      await expect(storage.checkReadiness()).resolves.toBe(false);
      await expect(storage.increment(email + token, 60_000, 5, 0, 'account-recovery'))
        .rejects.toThrow(ServiceUnavailableException);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith({
        event: 'RATE_LIMIT_REDIS_UNAVAILABLE',
        component: 'rate_limiting',
        backend: 'redis',
      });
      expect(logger.log).not.toHaveBeenCalled();
      const serialized = JSON.stringify(logger.warn.mock.calls);
      expect(serialized).not.toContain(redisUrl);
      expect(serialized).not.toContain(email);
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain('private-password');
    } finally {
      await storage.onApplicationShutdown();
    }
  });

  it('does not emit Redis state events in local in-memory mode', async () => {
    const storage = withRedis();
    const logger = { warn: vi.fn(), log: vi.fn() };
    (storage as unknown as { logger: typeof logger }).logger = logger;
    try {
      expect(await storage.checkReadiness()).toBe(true);
      await storage.increment('private-account', 60_000, 5, 0, 'account-recovery');
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.log).not.toHaveBeenCalled();
    } finally {
      await storage.onApplicationShutdown();
    }
  });

  it('retains existing local limits when Redis is not configured', async () => {
    const storage = withRedis();
    try {
      for (let i = 0; i < 3; i++) {
        const result = await storage.increment('client-1', 60_000, 3, 0, 'default');
        expect(result.isBlocked).toBe(false);
      }
      expect((await storage.increment('client-1', 60_000, 3, 0, 'default')).isBlocked)
        .toBe(true);
      expect((await storage.increment('client-2', 60_000, 3, 0, 'default')).isBlocked)
        .toBe(false);
    } finally {
      await storage.onApplicationShutdown();
    }
  });

  it('fails closed rather than switching to local memory when Redis is offline', async () => {
    const storage = withRedis('redis://127.0.0.1:1');
    try {
      await expect(storage.increment('client-1', 1000, 3, 0, 'default'))
        .rejects.toThrow(ServiceUnavailableException);
    } finally {
      await storage.onApplicationShutdown();
    }
  });
});
