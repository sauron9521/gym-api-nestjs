import {
  AuthenticationRegistry,
  JwtBearerProvider,
  JwtClaims,
} from '@nestjs/authentication';
import { UsersRepository } from '../../users/users.repository.js';
import { Injectable } from '@nestjs/common';
import type { UserResponse } from '../../users/dto/response-user.js';

@Injectable()
export class JwtAuth extends JwtBearerProvider<UserResponse> {
  constructor(
    private readonly usersRepository: UsersRepository,
    registry: AuthenticationRegistry,
  ) {
    super({ realm: 'store' });
    registry.registerProvider(this);
  }

  validate({ sub }: JwtClaims) {
    return sub ? this.usersRepository.findUserById(sub) : null;
  }
}
