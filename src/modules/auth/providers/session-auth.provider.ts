import {
  AuthenticationRegistry,
  SessionCookieProvider,
  SessionRecord,
} from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';
import { UsersRepository } from '../../users/users.repository.js';
import type { UserResponse } from '../../users/dto/response-user.js';

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
