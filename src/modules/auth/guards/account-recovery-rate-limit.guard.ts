import { createHmac } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import { isEmail } from 'class-validator';
import type { Request } from 'express';

import type { AppConfigService } from '#src/common/config/app-config.types';
import { DistributedThrottlerStorage } from '#src/common/rate-limit/distributed-throttler.storage';
import { normalizeRecoveryEmail } from '../utils/normalize-recovery-email.js';

export const RECOVERY_ACCOUNT_LIMIT = 5;
export const RECOVERY_ACCOUNT_TTL_MS = 60 * 60 * 1_000;

/**
 * Secondary account-address throttle for forgot-password only, independent
 * from the existing IP throttle. No user lookup means identical handling of
 * registered and unregistered addresses.
 */
@Injectable()
export class AccountRecoveryRateLimitGuard implements CanActivate {
  constructor(
    private readonly storage: DistributedThrottlerStorage,
    @Inject(ConfigService) private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const rawEmail: unknown = request.body?.email;

    // Invalid requests are handled by DTO validation and the global IP limit.
    // Do not allocate arbitrary keys for malformed or oversized input.
    if (typeof rawEmail !== 'string' || rawEmail.length > 254) {
      return true;
    }

    const email = normalizeRecoveryEmail(rawEmail);
    if (!isEmail(email)) {
      return true;
    }

    // HMAC, not a plain digest: attackers cannot enumerate guessed emails
    // from storage keys even if they obtain a snapshot of Redis.
    const accountKey = createHmac(
      'sha256',
      this.config.getOrThrow('JWT_SECRET'),
    )
      .update('auth:recovery:account:v1\0')
      .update(email)
      .digest('hex');

    // The store uses the same atomic Redis counter across replicas (or
    // process-local memory in single-instance development). Redis outages
    // fail closed as they already do for the standard IP throttler.
    const attempt = await this.storage.increment(
      `account-recovery:${accountKey}`,
      RECOVERY_ACCOUNT_TTL_MS,
      RECOVERY_ACCOUNT_LIMIT,
      0,
      'account-recovery',
    );
    if (attempt.isBlocked) {
      throw new ThrottlerException();
    }

    return true;
  }
}
