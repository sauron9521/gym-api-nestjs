import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import type { UserResponse } from '#src/modules/users/types/user-payload.types';
import { AuthAccountThrottleService, AUTH_ACCOUNT_THROTTLE_POLICIES } from '../services/auth-account-throttle.service.js';

export const VERIFICATION_RESEND_USER_LIMIT = AUTH_ACCOUNT_THROTTLE_POLICIES.verificationResend.limit;
export const VERIFICATION_RESEND_USER_TTL_MS = AUTH_ACCOUNT_THROTTLE_POLICIES.verificationResend.ttlMs;

type AuthenticatedRequest = Request & {
  user?: Pick<UserResponse, 'id' | 'emailVerified'>;
};

/**
 * A second quota for authenticated verification resends, independent of
 * client IP or active session. The normal auth and IP guards still run.
 */
@Injectable()
export class VerificationResendRateLimitGuard implements CanActivate {
  constructor(private readonly accountThrottle: AuthAccountThrottleService) {}

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

    await this.accountThrottle.assertAllowed(
      user.id,
      AUTH_ACCOUNT_THROTTLE_POLICIES.verificationResend,
    );

    return true;
  }
}
