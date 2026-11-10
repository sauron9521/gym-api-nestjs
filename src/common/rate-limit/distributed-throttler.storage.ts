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
  private redisAvailability: 'unknown' | 'healthy' | 'unavailable' = 'unknown';

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

    // ioredis errors can repeat rapidly during an outage. Mark state only;
    // never log the raw Error (which may expose connection credentials).
    this.redis?.on('error', () => this.markRedisUnavailable());
  }

  /**
   * Readiness of the actual throttling backend. With Redis disabled the
   * single-process memory store is always available; when enabled, use a
   * real PING rather than only trusting the connection's last status.
   * Errors remain private to prevent leaking Redis hosts or credentials.
   */
  async checkReadiness(): Promise<boolean> {
    if (!this.redis) return true;
    try {
      await this.ensureRedisReady(this.redis);
      if ((await this.redis.ping()) !== 'PONG') {
        this.markRedisUnavailable();
        return false;
      }
      this.markRedisHealthy();
      return true;
    } catch {
      this.markRedisUnavailable();
      return false;
    }
  }

  private async ensureRedisReady(redis: Redis): Promise<void> {
    if (redis.status === 'ready') return;

    // Share the first connection across requests and health probes.
    if (redis.status === 'wait' && !this.connectPromise) {
      this.connectPromise = redis.connect().finally(() => {
        this.connectPromise = null;
      });
    }
    if (this.connectPromise) await this.connectPromise;

    // Awaiting the promise changes ioredis' state outside TS control flow.
    if ((redis.status as string) !== 'ready') {
      throw new Error('Redis not ready');
    }
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
      await this.ensureRedisReady(this.redis);
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
      this.markRedisHealthy();
      return {
        totalHits: totalHits!,
        timeToExpire: Math.max(0, Math.ceil(expireMs! / 1000)),
        isBlocked: blocked === 1,
        timeToBlockExpire: Math.max(0, Math.ceil(blockMs! / 1000)),
      };
    } catch {
      // Never fall back to process-local memory after an enabled Redis fails:
      // doing so would silently bypass the distributed global rate limit.
      this.markRedisUnavailable();
      throw new ServiceUnavailableException('Rate limiting temporarily unavailable');
    }
  }

  /**
   * Emit at most one safe event per state transition. Never log the Redis
   * error, URL, raw throttle key or request data. Nest's JSON logger records
   * the event as structured fields in production.
   */
  private markRedisUnavailable(): void {
    if (this.redisAvailability === 'unavailable') return;
    this.redisAvailability = 'unavailable';
    this.logger.warn({
      event: 'RATE_LIMIT_REDIS_UNAVAILABLE',
      component: 'rate_limiting',
      backend: 'redis',
    });
  }

  private markRedisHealthy(): void {
    if (this.redisAvailability === 'healthy') return;
    const recovered = this.redisAvailability === 'unavailable';
    this.redisAvailability = 'healthy';
    if (recovered) {
      this.logger.log({
        event: 'RATE_LIMIT_REDIS_RECOVERED',
        component: 'rate_limiting',
        backend: 'redis',
      });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.redis?.disconnect();
    await this.memory.onApplicationShutdown();
  }
}
