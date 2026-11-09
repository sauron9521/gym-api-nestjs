import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { DistributedThrottlerStorage } from './distributed-throttler.storage.js';

function withRedis(url?: string): DistributedThrottlerStorage {
  return new DistributedThrottlerStorage({
    get: (key: string) => key === 'REDIS_URL' ? url : undefined,
  } as never);
}

describe('DistributedThrottlerStorage', () => {
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
