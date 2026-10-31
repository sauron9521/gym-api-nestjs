import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/index.js';
import { Prisma } from '../../generated/prisma/client.js';

export const userSelect = {
  id: true,
  email: true,
  emailVerified: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export const userSelectWithCredentials = {
  id: true,
  email: true,
  passwordHash: true,
  emailVerified: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(email: string, passwordHash: string) {
    try {
      return await this.prisma.user.create({
        data: { email, passwordHash },
        select: userSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('User with the same email already exists');
      }

      throw error;
    }
  }

  async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: userSelect,
    });
  }

  async findUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      select: userSelect,
    });
  }

  async findCredentials(email: string) {
    return this.prisma.user.findUnique({
      where: { email, deletedAt: null },
      select: userSelectWithCredentials,
    });
  }

  async updatePassHash(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
      select: userSelect,
    });
  }

  // relocation SERVICE AUTH?
  async checkEmail(email: string): Promise<void> {
    const user = await this.findUserByEmail(email);
    if (user?.email === email) {
      throw new ConflictException('User with the same email already exists');
    }
  }

  // relocation SERVICE AUTH?
  async markEmailVerified(userId: string, email: string): Promise<boolean> {
    const user = await this.findUserById(userId);
    if (!user) {
      throw new NotFoundException();
    }

    if (user.email !== email) {
      return false;
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true },
      select: {
        id: true,
        email: true,
        emailVerified: true,
      },
    });
    return true;
  }
}
