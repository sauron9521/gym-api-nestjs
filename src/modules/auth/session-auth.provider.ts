import {
  AuthenticationRegistry,
  SessionCookieProvider,
  SessionRecord,
} from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';
import { ViewUserDto } from '../users/dto/view-user.dto.js';
import { UsersRepository } from '../users/users.repository.js';

@Injectable()
export class SessionAuth extends SessionCookieProvider<ViewUserDto> {
  constructor(
    private readonly usersRepository: UsersRepository,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerProvider(this);
  }

  validate(session: SessionRecord) {
    return this.usersRepository.findUserById(session.id);
  }
}
