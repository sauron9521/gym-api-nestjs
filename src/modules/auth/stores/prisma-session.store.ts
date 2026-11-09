import { Injectable } from '@nestjs/common';
import {
  AuthenticationStorage,
  type MfaState,
  type SessionRecord,
  type SessionStore,
} from '@nestjs/authentication';
import {
  Prisma,
  type Session as PrismaSession,
} from '#prisma/client';
import { PrismaService } from '#src/infra/database/index';

@Injectable()
export class PrismaSessionStore implements SessionStore {
  constructor(
    private readonly prisma: PrismaService,
    storage: AuthenticationStorage,
  ) {
    // Реєструємо власне сховище сесій у @nestjs/authentication.
    storage.registerSource({ sessions: this });
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const session = await this.prisma.session.findUnique({
      where: { id, user: { deletedAt: null } },
    });

    return session ? this.toSessionRecord(session) : undefined;
  }

  async createSession(record: SessionRecord): Promise<void> {
    const data: Prisma.SessionUncheckedCreateInput = {
      id: record.id,
      userId: record.userId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      lastActiveAt: record.lastActiveAt,
      ...(record.mfa !== undefined ? { mfa: record.mfa } : {}),
      ...(record.metadata !== undefined
        ? { metadata: record.metadata as Prisma.InputJsonValue }
        : {}),
    };

    await this.prisma.session.create({ data });
  }

  async touchSession(id: string, lastActiveAt: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        id,
        user: { deletedAt: null },
        lastActiveAt: { lt: lastActiveAt },
      },
      data: { lastActiveAt },
    });
  }

  async deleteSession(id: string): Promise<boolean> {
    const result = await this.prisma.session.deleteMany({
      where: { id },
    });

    return result.count > 0;
  }

  async listUserSessions(userId: string): Promise<SessionRecord[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, user: { deletedAt: null } },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((session) => this.toSessionRecord(session));
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { userId },
    });
  }

  private toSessionRecord(session: PrismaSession): SessionRecord {
    return {
      id: session.id,
      userId: session.userId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastActiveAt: session.lastActiveAt,
      ...(session.mfa !== null ? { mfa: session.mfa as MfaState } : {}),
      ...(session.metadata !== null
        ? {
            metadata: session.metadata as Record<string, unknown>,
          }
        : {}),
    };
  }
}
