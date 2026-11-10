import { Transform } from 'class-transformer';
import { normalizeRecoveryEmail } from '../utils/normalize-recovery-email.js';

import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsStrongPassword,
  Matches,
} from 'class-validator';

export class SignInDto {
  @IsEmail()
  email: string;
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, {
    message: 'Password must contain at least one non-whitespace character',
  })
  password: string;
}
export class SignUpDto {
  @IsEmail()
  email: string;
  @IsStrongPassword()
  @Matches(/\S/, {
    message: 'Password must contain at least one non-whitespace character',
  })
  password: string;
}

export class EmailDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeRecoveryEmail(value) : value,
  )
  @IsEmail()
  email: string;
}

export class VerificationTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsStrongPassword()
  @IsNotEmpty()
  @Matches(/\S/, {
    message: 'Password must contain at least one non-whitespace character',
  })
  password: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
