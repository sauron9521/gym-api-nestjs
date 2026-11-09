import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '#src/infra/database/index';
import { Prisma } from '#prisma/client';

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
      firstName: true,
      lastName: true,
      displayName: true,
      avatarUrl: true,
      timezone: true,
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

  /**
   * Row-lock the user before changing an avatar reference.
   * Concurrent uploads, deletes and legacy avatarUrl PATCHes serialize
   * through this lock; the caller deletes the old managed blob after commit.
   */
  async replaceAvatar(
    userId: string,
    data: Prisma.ProfileCreateWithoutUserInput,
    avatarKey: string | null,
    skipMissingProfile = false,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "users"
        WHERE "id" = ${userId} AND "deleted_at" IS NULL
        FOR UPDATE
      `;

      if (rows.length !== 1) {
        throw new NotFoundException('User not found');
      }

      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { profile: { select: { avatarKey: true } } },
      });
      const previousKey = current?.profile?.avatarKey ?? null;

      // DELETE on a user without a profile must not create a blank row.
      if (skipMissingProfile && !current?.profile) {
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: userWithProfileSelect,
        });
        return { user, previousKey };
      }

      const user = await tx.user.update({
        where: { id: userId, deletedAt: null },
        data: {
          profile: {
            upsert: {
              create: { ...data, avatarKey },
              update: { ...data, avatarKey },
            },
          },
        },
        select: userWithProfileSelect,
      });

      return { user, previousKey };
    });
  }

  /** Public image lookup: exposes no account data, blocks orphaned keys. */
  async isCurrentAvatar(key: string): Promise<boolean> {
    const profile = await this.prisma.profile.findUnique({
      where: { avatarKey: key },
      select: { user: { select: { deletedAt: true } } },
    });

    return Boolean(profile && profile.user.deletedAt === null);
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
