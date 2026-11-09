import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '#src/infra/database/index';
import type { DistributedThrottlerStorage } from '#src/common/rate-limit/distributed-throttler.storage';
import { HealthController } from '../health.controller.js';

describe('HealthController', () => {
  it('reports liveness without querying PostgreSQL', () => {
    const prisma = { $queryRaw: vi.fn() };
    const controller = new HealthController(
      prisma as unknown as PrismaService,
      { checkReadiness: vi.fn().mockResolvedValue(true) } as unknown as DistributedThrottlerStorage,
    );
    expect(controller.liveness()).toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('reports readiness after a successful query', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ value: 1 }]) };
    const controller = new HealthController(
      prisma as unknown as PrismaService,
      { checkReadiness: vi.fn().mockResolvedValue(true) } as unknown as DistributedThrottlerStorage,
    );
    await expect(controller.readiness()).resolves.toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it('returns a generic 503 without leaking database errors', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('postgresql://secret@db')),
    };
    const controller = new HealthController(
      prisma as unknown as PrismaService,
      { checkReadiness: vi.fn().mockResolvedValue(true) } as unknown as DistributedThrottlerStorage,
    );
    await expect(controller.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(controller.readiness()).rejects.toThrow('Service unavailable');
  });
  it('rejects readiness when configured Redis throttling is unavailable', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ value: 1 }]) };
    const throttleStorage = { checkReadiness: vi.fn().mockResolvedValue(false) };
    const controller = new HealthController(
      prisma as unknown as PrismaService,
      throttleStorage as unknown as DistributedThrottlerStorage,
    );
    await expect(controller.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(throttleStorage.checkReadiness).toHaveBeenCalledOnce();
  });

  it('sanitizes Redis health probe errors', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ value: 1 }]) };
    const throttleStorage = {
      checkReadiness: vi.fn().mockRejectedValue(new Error('redis://password@private-host')),
    };
    const controller = new HealthController(
      prisma as unknown as PrismaService,
      throttleStorage as unknown as DistributedThrottlerStorage,
    );
    await expect(controller.readiness()).rejects.toThrow('Service unavailable');
  });
});
