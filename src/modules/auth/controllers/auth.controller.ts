import {
  Body,
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  EmailVerificationService,
  Public,
  SignInService,
} from '@nestjs/authentication';
import { Throttle } from '@nestjs/throttler';
import { SignInDto, SignUpDto } from '../dto/auth.dto.js';
import { CredentialsService } from '../services/index.js';

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly signInService: SignInService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  @Post('register')
  async signUp(@Body() signUpDto: SignUpDto) {
    const user = await this.credentialsService.register(signUpDto);
    await this.signInService.signIn(user.id, { method: 'password' });
    await this.emailVerificationService.send(user);
    return { ...user };
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('login')
  @HttpCode(200)
  async signIn(@Body() body: SignInDto) {
    const user = await this.credentialsService.verify(
      body.email,
      body.password,
    );
    if (!user) {
      throw new UnauthorizedException(
        'Invalid credentials! Wrong email or password.',
      );
    }

    const { session } = await this.signInService.signIn(user.id, {
      method: 'password',
    });
    return { mfaRequired: session.mfa === 'pending' };
  }
}
