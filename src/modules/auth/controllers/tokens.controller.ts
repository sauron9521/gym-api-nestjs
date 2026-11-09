import { Public, TokenService } from '@nestjs/authentication';
import {
  Body,
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import { AuthNoStoreInterceptor } from '../interceptors/auth-no-store.interceptor.js';
import { CredentialsService } from '../services/index.js';
import { RefreshTokenDto, SignInDto } from '../dto/auth.dto.js';
import { Throttle } from '@nestjs/throttler';

@Public()
@UseInterceptors(AuthNoStoreInterceptor)
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

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: RefreshTokenDto) {
    return this.tokenService.refresh(body.refreshToken);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('revoke')
  @HttpCode(204)
  async revoke(@Body() body: RefreshTokenDto): Promise<void> {
    await this.tokenService.revoke(body.refreshToken);
  }
}
