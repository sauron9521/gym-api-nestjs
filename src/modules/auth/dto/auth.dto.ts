import {
  IsEmail,
  IsStrongPassword,
  IsString,
  IsNotEmpty,
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
  token: string;

  @IsStrongPassword()
  password: string;
}
