import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../database/index.js';
import { HealthController } from '../health.controller.js';

describe('HealthController', () => {
  it('reports liveness without querying PostgreSQL', () => {
    const prisma = { $queryRaw: vi.fn() };
    const controller = new HealthController(prisma as unknown as PrismaService);
    expect(controller.liveness()).toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('reports readiness after a successful query', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ value: 1 }]) };
    const controller = new HealthController(prisma as unknown as PrismaService);
    await expect(controller.readiness()).resolves.toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it('returns a generic 503 without leaking database errors', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('postgresql://secret@db')),
    };
    const controller = new HealthController(prisma as unknown as PrismaService);
    await expect(controller.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(controller.readiness()).rejects.toThrow('Service unavailable');
  });
});
