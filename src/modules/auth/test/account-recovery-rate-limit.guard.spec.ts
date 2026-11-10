import type { ExecutionContext } from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DistributedThrottlerStorage } from '#src/common/rate-limit/distributed-throttler.storage';
import { EmailDto } from '../dto/auth.dto.js';
import { AuthAccountThrottleService } from '../services/auth-account-throttle.service.js';
import {
  AccountRecoveryRateLimitGuard,
  RECOVERY_ACCOUNT_LIMIT,
  RECOVERY_ACCOUNT_TTL_MS,
} from '../guards/account-recovery-rate-limit.guard.js';

describe('AccountRecoveryRateLimitGuard', () => {
  const increment = vi.fn();
  const storage = { increment } as unknown as DistributedThrottlerStorage;
  const config = {
    getOrThrow: vi.fn().mockReturnValue('local-test-HMAC-secret-with-32-or-more-characters'),
  };
  const guard = new AccountRecoveryRateLimitGuard(
    new AuthAccountThrottleService(storage, config as never),
  );

  function context(email: unknown): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ body: { email } }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    increment.mockResolvedValue({ isBlocked: false });
  });

  it('normalizes case, Unicode and surrounding whitespace to a stable opaque HMAC key', async () => {
    const raw = '  MeMbEr@Example.Test  ';
    const normalized = 'member@example.test';

    await expect(guard.canActivate(context(raw))).resolves.toBe(true);
    await expect(guard.canActivate(context(normalized))).resolves.toBe(true);

    expect(increment).toHaveBeenCalledTimes(2);
    const firstKey = increment.mock.calls[0]?.[0] as string;
    const secondKey = increment.mock.calls[1]?.[0] as string;
    expect(firstKey).toBe(secondKey);
    expect(firstKey).toMatch(/^account-recovery:[a-f0-9]{64}$/);
    expect(firstKey).not.toContain('member');
    expect(JSON.stringify(increment.mock.calls)).not.toContain('@');
    expect(increment).toHaveBeenCalledWith(
      firstKey,
      RECOVERY_ACCOUNT_TTL_MS,
      RECOVERY_ACCOUNT_LIMIT,
      0,
      'account-recovery',
    );
    expect(RECOVERY_ACCOUNT_LIMIT).toBe(5);
    expect(RECOVERY_ACCOUNT_TTL_MS).toBe(3_600_000);
  });

  it('counts heavily whitespace-padded valid emails rather than bypassing the quota', async () => {
    const padded = `${' '.repeat(350)}member@example.test${' '.repeat(350)}`;
    await expect(guard.canActivate(context(padded))).resolves.toBe(true);

    expect(increment).toHaveBeenCalledTimes(1);
    const key = increment.mock.calls[0]?.[0] as string;
    expect(key).toMatch(/^account-recovery:[a-f0-9]{64}$/);
    const dto = plainToInstance(EmailDto, { email: padded });
    expect(dto.email).toBe('member@example.test');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a blocked identity with a standard 429 before calling the controller', async () => {
    increment.mockResolvedValue({ isBlocked: true });

    await expect(
      guard.canActivate(context('member@example.test')),
    ).rejects.toMatchObject({ status: 429 });
    expect(increment).toHaveBeenCalledTimes(1);
  });

  it('does not create unbounded keys for invalid or oversized requests', async () => {
    for (const value of [null, 100, {}, '', 'not an email', 'x'.repeat(255)]) {
      await expect(guard.canActivate(context(value))).resolves.toBe(true);
    }
    expect(increment).not.toHaveBeenCalled();
  });

  it('fails closed when configured shared storage is unavailable', async () => {
    increment.mockRejectedValue(
      new ServiceUnavailableException('Rate limiting temporarily unavailable'),
    );
    await expect(
      guard.canActivate(context('member@example.test')),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('validates the normalized forgot-password email through the existing DTO', () => {
    const dto = plainToInstance(EmailDto, {
      email: '  MemBer@Example.Test  ',
    });
    expect(dto.email).toBe('member@example.test');
    expect(validateSync(dto)).toHaveLength(0);
  });
});
