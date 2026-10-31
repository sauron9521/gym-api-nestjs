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
import { SingInDto, SingUpDto } from './dto/auth.dto.js';
import { CredentialsService } from './services/index.js';

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly singInService: SignInService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  @Post('registry')
  async singUp(@Body() singUpDto: SingUpDto) {
    const user = await this.credentialsService.registry(singUpDto);
    await this.singInService.signIn(user.id, { method: 'password' });
    await this.emailVerificationService.send(user);
    return { ...user };
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('login')
  @HttpCode(200)
  async singIn(@Body() body: SingInDto) {
    const user = await this.credentialsService.verify(
      body.email,
      body.password,
    );
    if (!user) {
      throw new UnauthorizedException(
        'Invalid credentials! Wrong email or password.',
      );
    }

    const { session } = await this.singInService.signIn(user.id, {
      method: 'password',
    });
    return { mfaRequired: session.mfa === 'pending' };
  }
}
