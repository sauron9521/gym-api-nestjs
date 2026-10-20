import { Body, Controller, Post } from '@nestjs/common';
import { CreateUserDto } from '../users/dto/create-user.dto.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  @Post('sign-in')
  async login() {}

  @Post('register')
  async register(@Body() body: CreateUserDto) {
    const user = await this.authService.register(body);

    return { ...user };
  }
}
