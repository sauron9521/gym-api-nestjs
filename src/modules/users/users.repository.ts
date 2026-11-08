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

export const userWithProfileSelect = {
  ...userSelect,
  profile: {
    select: {
      name: true,
      birthday: true,
      height: true,
      weight: true,
    },
  },
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
        data: {
          email: normalizeEmail(email),
          passwordHash,
        },
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

  async findMe(id: string) {
    return this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      select: userWithProfileSelect,
    });
  }

  async upsertMyProfile(
    userId: string,
    data: Prisma.ProfileCreateWithoutUserInput,
  ) {
    try {
      // One atomic upsert, safe when two requests create a missing profile.
      return await this.prisma.user.update({
        where: { id: userId, deletedAt: null },
        data: {
          profile: {
            upsert: { create: data, update: data },
          },
        },
        select: userWithProfileSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('User not found');
      }
      throw error;
    }
  }

  async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
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
      where: { email: normalizeEmail(email), deletedAt: null },
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
    if (user) {
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

function normalizeEmail(email: string): string {
  return email.trim().normalize('NFC').toLowerCase();
}
