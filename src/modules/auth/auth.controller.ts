import {
  Body,
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Public, SignInService } from '@nestjs/authentication';
import { SingInDto, SingUpDto } from './dto/auth.dto.js';
import { CredentialsService } from './services/credentials.service.js';

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly singInService: SignInService,
  ) {}

  @Post('sing-up')
  async singUp(@Body() singUpDto: SingUpDto) {
    const user = await this.credentialsService.registry(
      singUpDto.email,
      singUpDto.password,
    );
    return { ...user };
  }

  @Post('sing-in')
  @HttpCode(200)
  async singIn(@Body() singInDto: SingInDto) {
    const user = await this.credentialsService.verify(
      singInDto.email,
      singInDto.password,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { session } = await this.singInService.signIn(user.id, {
      method: 'password',
    });
    return { mfaRequired: session.mfa === 'pending' };
  }
}
