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
import type { ViewUserDto } from '../users/dto/view-user.dto.js';

@Controller('auth/email')
export class EmailVerificationController {
  constructor(
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  @Public()
  @Post('verify')
  @HttpCode(200)
  async verifyEmail(@Body() body: { token: string }) {
    const verified = await this.emailVerificationService.verify(body.token);
    if (!verified) {
      throw new BadRequestException('Invalid or expired link');
    }
    return { email: verified.email, emailVerified: true };
  }

  @Post('verification')
  @HttpCode(202)
  async resend(@CurrentUser() user: ViewUserDto): Promise<void> {
    if (user.emailVerified) {
      throw new ConflictException('Email address already verified');
    }
    await this.emailVerificationService.send(user);
  }
}
