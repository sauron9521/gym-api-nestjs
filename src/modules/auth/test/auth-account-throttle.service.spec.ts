import { createHmac } from 'node:crypto';

import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DistributedThrottlerStorage } from '#src/common/rate-limit/distributed-throttler.storage';
import {
  AUTH_ACCOUNT_THROTTLE_POLICIES,
  AuthAccountThrottleService,
} from '../services/auth-account-throttle.service.js';

describe('AuthAccountThrottleService', () => {
  const secret = 'stable-test-secret-with-at-least-32-bytes';
  const increment = vi.fn();
  const config = { getOrThrow: vi.fn(() => secret) };
  const service = new AuthAccountThrottleService(
    { increment } as unknown as DistributedThrottlerStorage,
    config as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    increment.mockResolvedValue({ isBlocked: false });
  });

  it('preserves the exact existing password-recovery HMAC key and Redis counter parameters', async () => {
    const email = 'member@example.test';
    await service.assertAllowed(
      email,
      AUTH_ACCOUNT_THROTTLE_POLICIES.passwordRecovery,
    );

    const hmac = createHmac('sha256', secret)
      .update('auth:recovery:account:v1\0')
      .update(email)
      .digest('hex');

    expect(increment).toHaveBeenCalledExactlyOnceWith(
      `account-recovery:${hmac}`,
      3_600_000,
      5,
      0,
      'account-recovery',
    );
    expect(JSON.stringify(increment.mock.calls)).not.toContain(email);
    expect(config.getOrThrow).toHaveBeenCalledWith('JWT_SECRET');
  });

  it('preserves the exact verification-resend HMAC key and keeps policy namespaces distinct', async () => {
    const identity = 'same-identity';
    await service.assertAllowed(
      identity,
      AUTH_ACCOUNT_THROTTLE_POLICIES.passwordRecovery,
    );
    await service.assertAllowed(
      identity,
      AUTH_ACCOUNT_THROTTLE_POLICIES.verificationResend,
    );

    const verificationHmac = createHmac('sha256', secret)
      .update('auth:verification:resend:user:v1\0')
      .update(identity)
      .digest('hex');

    const passwordKey = increment.mock.calls[0]?.[0] as string;
    const verificationKey = increment.mock.calls[1]?.[0] as string;
    expect(passwordKey).not.toBe(verificationKey);
    expect(verificationKey).toBe(`verification-resend:${verificationHmac}`);
    expect(increment.mock.calls[1]).toEqual([
      verificationKey,
      3_600_000,
      5,
      0,
      'verification-resend-user',
    ]);
    expect(JSON.stringify(increment.mock.calls)).not.toContain(identity);
  });

  it('keeps the standard 429 response when either account policy is exhausted', async () => {
    increment.mockResolvedValue({ isBlocked: true });

    for (const policy of Object.values(AUTH_ACCOUNT_THROTTLE_POLICIES)) {
      await expect(service.assertAllowed('some-account', policy)).rejects
        .toMatchObject({ status: 429 });
    }
    expect(increment).toHaveBeenCalledTimes(2);
  });

  it('propagates configured Redis outages instead of silently allowing the request', async () => {
    increment.mockRejectedValue(
      new ServiceUnavailableException('Rate limiting temporarily unavailable'),
    );
    await expect(
      service.assertAllowed(
        'some-account',
        AUTH_ACCOUNT_THROTTLE_POLICIES.verificationResend,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
