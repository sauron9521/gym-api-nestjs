import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';

import type { AppConfigService } from '#src/common/config/app-config.types';
import { DistributedThrottlerStorage } from '#src/common/rate-limit/distributed-throttler.storage';

/**
 * Preserve the existing storage namespaces and thresholds. Changing any
 * namespace silently resets active counters in Redis during a deployment.
 */
export const AUTH_ACCOUNT_THROTTLE_POLICIES = {
  passwordRecovery: {
    namespace: 'auth:recovery:account:v1\0',
    keyPrefix: 'account-recovery',
    throttlerName: 'account-recovery',
    limit: 5,
    ttlMs: 60 * 60 * 1_000,
  },
  verificationResend: {
    namespace: 'auth:verification:resend:user:v1\0',
    keyPrefix: 'verification-resend',
    throttlerName: 'verification-resend-user',
    limit: 5,
    ttlMs: 60 * 60 * 1_000,
  },
} as const;

export type AuthAccountThrottlePolicy =
  (typeof AUTH_ACCOUNT_THROTTLE_POLICIES)[keyof typeof AUTH_ACCOUNT_THROTTLE_POLICIES];

/**
 * Shared opaque account-key generation and atomic fixed-window enforcement.
 * Guards validate their own identity sources; this service never looks up
 * users or logs identifiers and propagates storage failures unchanged.
 */
@Injectable()
export class AuthAccountThrottleService {
  constructor(
    private readonly storage: DistributedThrottlerStorage,
    @Inject(ConfigService) private readonly config: AppConfigService,
  ) {}

  async assertAllowed(identity: string, policy: AuthAccountThrottlePolicy): Promise<void> {
    const opaqueIdentity = createHmac(
      'sha256',
      this.config.getOrThrow('JWT_SECRET'),
    )
      .update(policy.namespace)
      .update(identity)
      .digest('hex');

    const attempt = await this.storage.increment(
      `${policy.keyPrefix}:${opaqueIdentity}`,
      policy.ttlMs,
      policy.limit,
      0,
      policy.throttlerName,
    );

    if (attempt.isBlocked) {
      throw new ThrottlerException();
    }
  }
}
