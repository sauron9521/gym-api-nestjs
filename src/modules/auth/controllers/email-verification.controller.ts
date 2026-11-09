import {
  CurrentUser,
  EmailVerificationService,
  Public,
} from '@nestjs/authentication';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Logger,
  Post,
  ServiceUnavailableException,
  UseInterceptors,
} from '@nestjs/common';
import { AuthNoStoreInterceptor } from '../interceptors/auth-no-store.interceptor.js';
import { Throttle } from '@nestjs/throttler';
import { VerificationTokenDto } from '../dto/auth.dto.js';
import type { UserResponse } from '#src/modules/users/types/user-payload.types';

@UseInterceptors(AuthNoStoreInterceptor)
@Controller('auth/email')
export class EmailVerificationController {
  private readonly logger = new Logger(EmailVerificationController.name);

  constructor(
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  @Post('verify')
  @HttpCode(200)
  async verifyEmail(@Body() body: VerificationTokenDto) {
    const verified = await this.emailVerificationService.verify(body.token);
    if (!verified) {
      throw new BadRequestException('Invalid or expired link');
    }
    return { email: verified.email, emailVerified: true };
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('verification')
  @HttpCode(202)
  async resend(@CurrentUser() user: UserResponse): Promise<void> {
    if (user.emailVerified) {
      throw new ConflictException('Email address already verified');
    }
    try {
      await this.emailVerificationService.send(user);
    } catch {
      // Do not expose or log email addresses, verification links or SMTP errors.
      this.logger.warn('AUTH_VERIFICATION_EMAIL_RESEND_FAILED');
      throw new ServiceUnavailableException(
        'Verification email is temporarily unavailable. Please retry later.',
      );
    }
  }
}
