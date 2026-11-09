import {
  AuthenticationRegistry,
  JwtBearerProvider,
  JwtClaims,
} from '@nestjs/authentication';
import { UsersRepository } from '#src/modules/users/users.repository';
import { Injectable } from '@nestjs/common';
import type { UserResponse } from '#src/modules/users/dto/response-user';

@Injectable()
export class JwtAuth extends JwtBearerProvider<UserResponse> {
  constructor(
    private readonly usersRepository: UsersRepository,
    registry: AuthenticationRegistry,
  ) {
    super({ realm: 'store' });
    registry.registerProvider(this, { order: 1 });
  }

  validate({ sub }: JwtClaims) {
    return sub ? this.usersRepository.findUserById(sub) : null;
  }
}
