import { PasswordHasher } from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';
import { UsersRepository } from '#src/modules/users/repositories/users.repository';
import type { SignUpDto } from '../dto/auth.dto.js';
import { toAuthenticatedUser } from '../mappers/auth-credential-user.mapper.js';
import type { UserResponse } from '#src/modules/users/types/user-payload.types';

@Injectable()
export class CredentialsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async register(dto: SignUpDto): Promise<UserResponse> {
    await this.usersRepository.checkEmail(dto.email);
    const hashedPassword = await this.passwordHasher.hash(dto.password);
    return this.usersRepository.create(dto.email, hashedPassword);
  }

  async verify(email: string, password: string): Promise<UserResponse | null> {
    const data = await this.usersRepository.findCredentials(email);
    const valid = await this.checkPassword(password, data?.passwordHash);

    if (!data || !valid) {
      return null;
    }
    if (this.passwordHasher.needsRehash(data.passwordHash)) {
      await this.usersRepository.updatePassHash(
        data.id,
        await this.passwordHasher.hash(password),
      );
    }

    return toAuthenticatedUser(data);
  }

  private async checkPassword(
    password: string,
    storePassword: string | undefined,
  ): Promise<boolean> {
    return this.passwordHasher.verify(password, storePassword);
  }
}
