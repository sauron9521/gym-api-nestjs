import { Public, TokenService } from '@nestjs/authentication';
import {
  Body,
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { CredentialsService } from '../services/index.js';
import { RefreshTokenDto, SignInDto } from '../dto/auth.dto.js';
import { Throttle } from '@nestjs/throttler';

@Public()
@Controller('auth/token')
export class TokensController {
  constructor(
    private readonly credentialService: CredentialsService,
    private readonly tokenService: TokenService,
  ) {}

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post()
  @HttpCode(200)
  async issue(@Body() body: SignInDto) {
    const user = await this.credentialService.verify(body.email, body.password);

    if (!user) {
      throw new UnauthorizedException();
    }
    return this.tokenService.issue(user.id, {
      method: 'password',
      claims: { amr: ['pwd'] },
    });
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: RefreshTokenDto) {
    return this.tokenService.refresh(body.refreshToken);
  }

  @Post('revoke')
  @HttpCode(204)
  async revoke(@Body() body: RefreshTokenDto): Promise<void> {
    await this.tokenService.revoke(body.refreshToken);
  }
}
