import { createHmac } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request } from 'express';

import type { AppConfigService } from '#src/common/config/app-config.types';
import { DistributedThrottlerStorage } from '#src/common/rate-limit/distributed-throttler.storage';
import type { UserResponse } from '#src/modules/users/types/user-payload.types';

export const VERIFICATION_RESEND_USER_LIMIT = 5;
export const VERIFICATION_RESEND_USER_TTL_MS = 60 * 60 * 1_000;

type AuthenticatedRequest = Request & {
  user?: Pick<UserResponse, 'id' | 'emailVerified'>;
};

/**
 * A second quota for authenticated verification resends, independent of
 * client IP or active session. The normal auth and IP guards still run.
 */
@Injectable()
export class VerificationResendRateLimitGuard implements CanActivate {
  constructor(
    private readonly storage: DistributedThrottlerStorage,
    @Inject(ConfigService) private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // This endpoint is authenticated. Never allocate anonymous/empty keys.
    if (typeof user?.id !== 'string' || !user.id) {
      throw new UnauthorizedException();
    }

    // Preserve the controller's existing 409 for already-verified users.
    // Only unverified users can generate verification emails.
    if (user.emailVerified) {
      return true;
    }

    // A keyed digest prevents guessing user IDs from a Redis key snapshot.
    // Domain separation keeps this quota independent of password recovery.
    const identityKey = createHmac(
      'sha256',
      this.config.getOrThrow('JWT_SECRET'),
    )
      .update('auth:verification:resend:user:v1\0')
      .update(user.id)
      .digest('hex');

    const attempt = await this.storage.increment(
      `verification-resend:${identityKey}`,
      VERIFICATION_RESEND_USER_TTL_MS,
      VERIFICATION_RESEND_USER_LIMIT,
      0,
      'verification-resend-user',
    );
    if (attempt.isBlocked) {
      throw new ThrottlerException();
    }
    return true;
  }
}
