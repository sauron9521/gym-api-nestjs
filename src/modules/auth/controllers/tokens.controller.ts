import { Public, TokenService } from '@nestjs/authentication';
import {
  Body,
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { CredentialsService } from '../services/index.js';
import { SingInDto } from '../dto/auth.dto.js';

@Public()
@Controller('auth/token')
export class TokensController {
  constructor(
    private readonly credentialService: CredentialsService,
    private readonly tokenService: TokenService,
  ) {}

  @Post()
  @HttpCode(200)
  async issue(@Body() body: SingInDto) {
    const user = await this.credentialService.verify(body.email, body.password);

    if (!user) {
      throw new UnauthorizedException();
    }
    return this.tokenService.issue(user.id, {
      method: 'password',
      claims: { amr: ['pwd'] },
    });
  }
}