import { IsEmail, IsStrongPassword, IsString } from 'class-validator';

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
