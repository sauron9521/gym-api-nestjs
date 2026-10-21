import { PasswordHasher } from '@nestjs/authentication';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ViewUserDto } from '../users/dto/view-user.dto.js';
import { UsersRepository } from '../users/users.repository.js';

@Injectable()
export class CredentialsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async registry(email: string, password: string): Promise<ViewUserDto> {
    await this.usersRepository.checkEmail(email);

    const hashedPassword = await this.passwordHasher.hash(password);

    const user = await this.usersRepository.create({
      email,
      password: hashedPassword,
    });

    return { ...user };
  }

  async verify(email: string, password: string): Promise<ViewUserDto | null> {
    const found = await this.usersRepository.findCredentials(email);
    const valid = await this.passwordHasher.verify(password, found?.passHash);

    console.log(valid);
    if (!found || !valid) {
      throw new NotFoundException('Invalid credentials');
    }
    if (this.passwordHasher.needsRehash(found.passHash)) {
      await this.usersRepository.updatePassHash(
        found.id,
        await this.passwordHasher.hash(password),
      );
    }

    return found;
  }
}
