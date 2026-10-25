import { PasswordHasher } from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';
import { ViewUserDto } from '../../users/dto/view-user.dto.js';
import { UsersRepository } from '../../users/users.repository.js';
import { SingUpDto } from '../dto/auth.dto.js';

@Injectable()
export class CredentialsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async registry(singUpDto: SingUpDto): Promise<ViewUserDto> {
    const { email, password } = singUpDto;
    await this.usersRepository.checkEmail(email);
    const hashedPassword = await this.passwordHasher.hash(password);

    return await this.usersRepository.create({
      email: email,
      password: hashedPassword,
    });
  }

  async verify(email: string, password: string): Promise<ViewUserDto | null> {
    const data = await this.usersRepository.findCredentials(email);
    const valid = await this.checkPassword(password, data?.passHash);

    if (!data || !valid) {
      return null;
    }
    if (this.passwordHasher.needsRehash(data.passHash)) {
      await this.usersRepository.updatePassHash(
        data.id,
        await this.passwordHasher.hash(password),
      );
    }

    //TODO Unused variable passHash, need rework returning types
    const { passHash, ...user } = data;
    return { ...user };
  }

  private async checkPassword(
    password: string,
    storePassword: string | undefined,
  ): Promise<boolean> {
    return this.passwordHasher.verify(password, storePassword);
  }
}
