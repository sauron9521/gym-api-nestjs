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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { ViewUserDto } from '../../users/dto/view-user.dto.js';
import { VerificationTokenDto } from '../dto/auth.dto.js';

@Controller('auth/email')
export class EmailVerificationController {
  constructor(
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  @Public()
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
  async resend(@CurrentUser() user: ViewUserDto): Promise<void> {
    if (user.emailVerified) {
      throw new ConflictException('Email address already verified');
    }
    await this.emailVerificationService.send(user);
  }
}
