import {
  AuthenticationRegistry,
  SessionCookieProvider,
  SessionRecord,
} from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';
import { UsersRepository } from '#src/modules/users/users.repository';
import type { UserResponse } from '#src/modules/users/dto/response-user';

@Injectable()
export class SessionAuth extends SessionCookieProvider<UserResponse> {
  constructor(
    private readonly usersRepository: UsersRepository,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerProvider(this);
  }

  validate(session: SessionRecord) {
    return this.usersRepository.findUserById(session.userId);
  }
}
