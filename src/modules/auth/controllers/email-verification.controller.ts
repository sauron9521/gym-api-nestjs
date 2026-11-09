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
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { AuthNoStoreInterceptor } from '../interceptors/auth-no-store.interceptor.js';
import { Throttle } from '@nestjs/throttler';
import { VerificationTokenDto } from '../dto/auth.dto.js';
import type { UserResponse } from '#src/modules/users/types/user-payload.types';

@UseInterceptors(AuthNoStoreInterceptor)
@Controller('auth/email')
export class EmailVerificationController {
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
    await this.emailVerificationService.send(user);
  }
}
