import { Injectable } from '@nestjs/common';
import { CreateUserDto } from '../users/dto/create-user.dto.js';
import { UsersRepository } from '../users/users.repository.js';

@Injectable()
export class AuthService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async register(createUserDto: CreateUserDto) {
    return await this.usersRepository.create(createUserDto);
  }
}
