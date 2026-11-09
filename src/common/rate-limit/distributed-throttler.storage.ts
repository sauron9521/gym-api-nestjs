import { createHash } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ThrottlerStorageService,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { Redis } from 'ioredis';

import type { AppConfigService } from '#src/common/config/app-config.types';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Atomic fixed-window count and optional timed block. A stable SHA-256 digest
 * keeps client IPs and route paths out of Redis keys.
 *
 * KEYS[1] count, KEYS[2] block
 * ARGV: TTL(ms), limit, blockDuration(ms)
 */
export const RATE_LIMIT_LUA = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then
  local window = redis.call('PTTL', KEYS[1])
  return {tonumber(ARGV[2]) + 1, math.max(window, 0), 1, blocked}
end

local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local remaining = redis.call('PTTL', KEYS[1])
if remaining < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  remaining = tonumber(ARGV[1])
end

local denied = hits > tonumber(ARGV[2])
local blockTime = 0
if denied then
  blockTime = remaining
  if tonumber(ARGV[3]) > 0 then
    redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
    blockTime = tonumber(ARGV[3])
  end
end
return {hits, remaining, denied and 1 or 0, blockTime}
`;

@Injectable()
export class DistributedThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger(DistributedThrottlerStorage.name);
  private readonly memory = new ThrottlerStorageService();
  private readonly redis: Redis | null;
  private connectPromise: Promise<void> | null = null;

  constructor(@Inject(ConfigService) config: AppConfigService) {
    const url = config.get('REDIS_URL');
    this.redis = url
      ? new Redis(url, {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 2_000,
          retryStrategy: (attempt: number) => Math.min(attempt * 250, 2_000),
        })
      : null;

    // ioredis emits errors even for connection failures. Do not log URLs,
    // network endpoints, passwords, or the untrusted request tracker.
    this.redis?.on('error', () => {
      this.logger.warn('RATE_LIMIT_REDIS_ERROR');
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.redis) {
      return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    }

    const hash = createHash('sha256')
      .update(throttlerName)
      .update(':')
      .update(key)
      .digest('hex');
    const counterKey = `gym:throttle:${hash}`;
    const blockedKey = `gym:throttle:block:${hash}`;

    try {
      if (this.redis.status !== 'ready') {
        // All concurrent requests share the first connection attempt.
        // Calling ioredis.connect() twice while connecting throws, and must
        // not reject legitimate requests as 503 during initial startup.
        if (this.redis.status === 'wait' && !this.connectPromise) {
          this.connectPromise = this.redis.connect().finally(() => {
            this.connectPromise = null;
          });
        }
        if (this.connectPromise) await this.connectPromise;
        if (this.redis.status !== 'ready') {
          throw new Error('Redis not ready');
        }
      }
      const reply: unknown = await this.redis.eval(
        RATE_LIMIT_LUA,
        2,
        counterKey,
        blockedKey,
        String(ttl),
        String(limit),
        String(blockDuration),
      );
      if (
        !Array.isArray(reply) ||
        reply.length !== 4 ||
        !reply.every((value) => typeof value === 'number' && Number.isFinite(value))
      ) {
        throw new Error('Unexpected Redis result');
      }
      const [totalHits, expireMs, blocked, blockMs] = reply as number[];
      return {
        totalHits: totalHits!,
        timeToExpire: Math.max(0, Math.ceil(expireMs! / 1000)),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.max(0, Math.ceil(blockMs! / 1000)),
      };
    } catch {
      // Never fall back to process-local memory after an enabled Redis fails:
      // doing so would silently bypass the distributed global rate limit.
      this.logger.warn('RATE_LIMIT_REDIS_UNAVAILABLE');
      throw new ServiceUnavailableException('Rate limiting temporarily unavailable');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.redis?.disconnect();
    await this.memory.onApplicationShutdown();
  }
}
