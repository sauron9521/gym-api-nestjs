import { IsEmail, IsEnum, IsNotEmpty, IsStrongPassword } from 'class-validator';
import { Role } from '../../../generated/prisma/client.js';

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsNotEmpty()
  @IsStrongPassword()
  password: string;

  @IsEnum(Role)
  role?: Role;
}
