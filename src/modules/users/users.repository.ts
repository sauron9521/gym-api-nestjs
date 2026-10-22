import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/index.js';
import { SingUpDto } from '../auth/dto/auth.dto.js';
import { ViewUserDto } from './dto/view-user.dto.js';
import type { Users } from './../../generated/prisma/client.js';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(email: string, password: string): Promise<ViewUserDto> {
    const user = await this.prisma.users.create({
      data: {
        email,
        passHash: password,
      },
      omit: {
        passHash: true,
      },
    });

    return { ...user };
  }

  async findUserByEmail(email: string): Promise<ViewUserDto> {
    const user = await this.prisma.users.findUnique({
      where: { email },
      omit: { passHash: true },
    });
    if (!user) {
      throw new NotFoundException('User by email not found');
    }

    return { ...user };
  }

  async findUserById(id: string): Promise<ViewUserDto> {
    const user = await this.prisma.users.findUnique({
      where: { id },
      omit: { passHash: true },
    });
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
      throw new NotFoundException('Invalid credentials');
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
    if (user?.email === email) {
      throw new ConflictException('User with the same email already exists');
    }
  }

  async markEmailVerified(userId: string, email: string): Promise<boolean> {
    const user = await this.findUserById(userId);

    if (user.email !== email) {
      return false;
    }
    await this.prisma.users.update({
      where: { id: userId },
      data: { emailVerified: true },
      omit: { passHash: true },
    });
    return true;
  }
}
