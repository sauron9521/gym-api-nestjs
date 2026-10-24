import { PasswordResetService, Public } from '@nestjs/authentication';
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EmailDto, ResetPasswordDto } from '../dto/auth.dto.js';

@Public()
@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(private readonly passwordResetService: PasswordResetService) {}

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('forgot')
  @HttpCode(202)
  async forgot(@Body() body: EmailDto): Promise<void> {
    this.passwordResetService.request(body.email);
  }

  @Post('reset')
  @HttpCode(200)
  async reset(@Body() body: ResetPasswordDto) {
    const result = await this.passwordResetService.reset(
      body.token,
      body.password,
      { signIn: true },
    );
    if (!result) {
      throw new BadRequestException('Invalid or expired link');
    }
    return { mfaRequired: result.signedIn?.session.mfa === 'pending' };
  }
}
