import { PasswordHasher } from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';
import { UsersRepository } from '../../users/users.repository.js';
import { SingUpDto } from '../dto/auth.dto.js';
import type { UserResponse } from '../../users/dto/response-user.js';

@Injectable()
export class CredentialsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async registry(dto: SingUpDto): Promise<UserResponse> {
    await this.usersRepository.checkEmail(dto.email);
    const hashedPassword = await this.passwordHasher.hash(dto.password);

    return await this.usersRepository.create(dto.email, hashedPassword);
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

    const { passwordHash: _passHash, ...user } = data;
    return { ...user };
  }

  private async checkPassword(
    password: string,
    storePassword: string | undefined,
  ): Promise<boolean> {
    return this.passwordHasher.verify(password, storePassword);
  }
}
