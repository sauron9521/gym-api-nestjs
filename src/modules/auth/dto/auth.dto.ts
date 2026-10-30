import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsStrongPassword,
} from 'class-validator';

export class SingInDto {
  @IsEmail()
  email: string;
  @IsString()
  password: string;
}
export class SingUpDto {
  @IsEmail()
  email: string;
  @IsStrongPassword()
  password: string;
}

export class EmailDto {
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
  password: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
