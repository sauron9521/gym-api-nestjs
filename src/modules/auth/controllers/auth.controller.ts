import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import { AuthNoStoreInterceptor } from '../interceptors/auth-no-store.interceptor.js';
import {
  EmailVerificationService,
  Public,
  SignInService,
} from '@nestjs/authentication';
import { Throttle } from '@nestjs/throttler';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { registrationResponseSchema } from '#src/infra/openapi/response-contracts';
import { SignInDto, SignUpDto } from '../dto/auth.dto.js';
import { CredentialsService } from '../services/index.js';

@Public()
@ApiTags('Authentication')
@UseInterceptors(AuthNoStoreInterceptor)
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly signInService: SignInService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('register')
  @ApiCreatedResponse({ schema: registrationResponseSchema })
  async signUp(@Body() signUpDto: SignUpDto) {
    const user = await this.credentialsService.register(signUpDto);
    await this.signInService.signIn(user.id, { method: 'password' });

    // Registration and session creation have already committed. A failed
    // email submission must not turn that successful operation into a 500:
    // retrying POST /auth/register would otherwise return 409.
    let verificationEmailStatus: 'SUBMITTED' | 'RETRY_REQUIRED' = 'SUBMITTED';
    try {
      await this.emailVerificationService.send(user);
    } catch {
      // Never log a token, address, provider error or credentials.
      this.logger.warn('AUTH_REGISTRATION_VERIFICATION_EMAIL_SUBMISSION_FAILED');
      verificationEmailStatus = 'RETRY_REQUIRED';
    }

    return { ...user, verificationEmailStatus };
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
