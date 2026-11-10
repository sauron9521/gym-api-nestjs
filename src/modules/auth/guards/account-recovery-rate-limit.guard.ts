import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { isEmail } from 'class-validator';
import type { Request } from 'express';

import { normalizeRecoveryEmail } from '../utils/normalize-recovery-email.js';
import { AuthAccountThrottleService, AUTH_ACCOUNT_THROTTLE_POLICIES } from '../services/auth-account-throttle.service.js';

export const RECOVERY_ACCOUNT_LIMIT = AUTH_ACCOUNT_THROTTLE_POLICIES.passwordRecovery.limit;
export const RECOVERY_ACCOUNT_TTL_MS = AUTH_ACCOUNT_THROTTLE_POLICIES.passwordRecovery.ttlMs;

/**
 * Secondary account-address throttle for forgot-password only, independent
 * from the existing IP throttle. No user lookup means identical handling of
 * registered and unregistered addresses.
 */
@Injectable()
export class AccountRecoveryRateLimitGuard implements CanActivate {
  constructor(private readonly accountThrottle: AuthAccountThrottleService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const rawEmail: unknown = request.body?.email;

    // Invalid requests are handled by DTO validation and the global IP limit.
    // Do not allocate arbitrary keys for malformed or oversized input.
    if (typeof rawEmail !== 'string') {
      return true;
    }

    // Normalize first: a padded but otherwise valid address must not bypass
    // the quota simply because its raw input exceeds 254 characters.
    const email = normalizeRecoveryEmail(rawEmail);
    if (email.length > 254 || !isEmail(email)) {
      return true;
    }

    await this.accountThrottle.assertAllowed(
      email,
      AUTH_ACCOUNT_THROTTLE_POLICIES.passwordRecovery,
    );

    return true;
  }
}
