import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Hasher } from '../../common/security/hasher.js';
import { PrismaService } from '../../prisma/index.js';
import { CreateUserDto } from './dto/create-user.dto.js';

import { ViewUserDto } from './dto/view-user.dto.js';
import type { Users } from './../../generated/prisma/client.js';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto): Promise<ViewUserDto> {
    const { email, password } = createUserDto;
    await this.checkEmail(email);

    const hashedPassword = await Hasher.hash(password);

    const user = await this.prisma.users.create({
      data: {
        email,
        passHash: hashedPassword,
      },
      omit: {
        passHash: true,
      },
    });

    return { ...user };
  }

  async findUserByEmail(email: string): Promise<ViewUserDto | null> {
    const user = await this.prisma.users.findUnique({ where: { email } });

    if (!user) {
      throw new NotFoundException('User by email not found');
    }

    return { ...user };
  }

  async findUserById(id: string): Promise<ViewUserDto> {
    const user = await this.prisma.users.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User by id not found');
    }

    return { ...user };
  }

  async findCredentials(email: string): Promise<Users | null> {
    const credentials = await this.prisma.users.findUnique({
      where: { email },
    });
    if (!credentials) {
      throw new NotFoundException('User by email not found');
    }

    return { ...credentials };
  }

  async updatePassHash(id: string, passHash: string): Promise<void> {
    await this.prisma.users.update({
      where: { id },
      data: { passHash },
    });
  }

  async checkEmail(email: string): Promise<void> {
    const user = await this.prisma.users.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    console.log(user, 'user');
    if (user?.email === email) {
      throw new ConflictException('User with the same email already exists');
    }
  }
}
