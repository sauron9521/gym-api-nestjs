import {
  AuthenticationRegistry,
  PasswordResetHandler,
  type PasswordResetLink,
} from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';
import { type Mailable, Mailer } from '@nestjs/mail';
import { UsersRepository } from '../../users/users.repository.js';

@Injectable()
export class PasswordResetMail implements Mailable<PasswordResetLink> {
  render({ url }: PasswordResetLink) {
    return {
      subject: 'Reset your password',
      template: 'password-reset',
      context: { url },
    };
  }
}

@Injectable()
export class PasswordResetMailer extends PasswordResetHandler {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly mailer: Mailer,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerHandler('passwordReset', this);
  }

  async findUser(email: string) {
    const found = await this.usersRepository.findCredentials(email);
    return (
      found && {
        id: found.id,
        email: found.email,
        passwordHash: found.passHash,
      }
    );
  }

  async send(link: PasswordResetLink) {
    await this.mailer.send(PasswordResetMail, { to: link.email, data: link });
  }

  updatePassword(userId: string, passwordHash: string) {
    return this.usersRepository.updatePassHash(userId, passwordHash);
  }
}
