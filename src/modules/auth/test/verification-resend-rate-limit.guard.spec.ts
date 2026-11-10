import type { ExecutionContext } from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DistributedThrottlerStorage } from '#src/common/rate-limit/distributed-throttler.storage';
import {
  VerificationResendRateLimitGuard,
  VERIFICATION_RESEND_USER_LIMIT,
  VERIFICATION_RESEND_USER_TTL_MS,
} from '../guards/verification-resend-rate-limit.guard.js';

describe('VerificationResendRateLimitGuard', () => {
  const increment = vi.fn();
  const config = {
    getOrThrow: vi.fn().mockReturnValue('shared-test-secret-32-bytes-or-longer'),
  };
  const guard = new VerificationResendRateLimitGuard(
    { increment } as unknown as DistributedThrottlerStorage,
    config as never,
  );

  function context(id?: string, emailVerified = false): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: id ? { id, emailVerified } : undefined,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    increment.mockResolvedValue({ isBlocked: false });
  });

  it('uses stable opaque per-user keys independent of session and IP', async () => {
    await expect(guard.canActivate(context('user-1'))).resolves.toBe(true);
    await expect(guard.canActivate(context('user-1'))).resolves.toBe(true);
    await expect(guard.canActivate(context('user-2'))).resolves.toBe(true);

    expect(increment).toHaveBeenCalledTimes(3);
    const first = increment.mock.calls[0]?.[0] as string;
    expect(first).toBe(increment.mock.calls[1]?.[0]);
    expect(first).not.toBe(increment.mock.calls[2]?.[0]);
    expect(first).toMatch(/^verification-resend:[a-f0-9]{64}$/);
    expect(JSON.stringify(increment.mock.calls)).not.toContain('user-1');
    expect(increment).toHaveBeenCalledWith(
      first,
      VERIFICATION_RESEND_USER_TTL_MS,
      VERIFICATION_RESEND_USER_LIMIT,
      0,
      'verification-resend-user',
    );
    expect(VERIFICATION_RESEND_USER_LIMIT).toBe(5);
    expect(VERIFICATION_RESEND_USER_TTL_MS).toBe(3_600_000);
  });

  it('returns 429 before the resend handler when the user is over quota', async () => {
    increment.mockResolvedValue({ isBlocked: true });
    await expect(guard.canActivate(context('user-1'))).rejects.toMatchObject({
      status: 429,
    });
    expect(increment).toHaveBeenCalledTimes(1);
  });

  it('does not allocate a counter for anonymous or already-verified users', async () => {
    await expect(guard.canActivate(context())).rejects.toMatchObject({
      status: 401,
    });
    await expect(guard.canActivate(context('user-1', true))).resolves.toBe(true);
    expect(increment).not.toHaveBeenCalled();
  });

  it('propagates Redis failures without bypassing the quota', async () => {
    increment.mockRejectedValue(
      new ServiceUnavailableException('Rate limiting temporarily unavailable'),
    );
    await expect(guard.canActivate(context('user-1'))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
