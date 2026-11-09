import { Injectable } from '@nestjs/common';
import {
  AuthenticationStorage,
  type EmailTokenPurpose,
  type EmailTokenRecord,
  type EmailTokenStore,
  type RefreshTokenRecord,
  type RefreshTokenStore,
} from '@nestjs/authentication';
import { Prisma } from '#prisma/client';
import { PrismaService } from '#src/infra/database/index';
import {
  authPendingEmailTokenCutoffSelect,
  authRefreshTokenFamilyRevocationSelect,
  authRefreshTokenSelect,
  authRevokedRefreshTokenSelect,
} from '../selects/auth-token.select.js';
import { toEmailTokenRecord, toRefreshTokenRecord } from '../mappers/auth-token.mapper.js';
import type { AuthConsumedEmailTokenRow } from '../types/auth-store.types.js';

/** PostgreSQL-backed stores for opaque refresh tokens and email links. */
@Injectable()
export class PrismaTokenStore implements RefreshTokenStore, EmailTokenStore {
  constructor(
    private readonly prisma: PrismaService,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({ refreshTokens: this, emailTokens: this });
  }

  protected readonly maxPending: number = 10_000;

  async getRefreshToken(id: string): Promise<RefreshTokenRecord | undefined> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { id, user: { deletedAt: null } },
      select: authRefreshTokenSelect,
    });

    return row ? toRefreshTokenRecord(row) : undefined;
  }

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshTokenFamily.upsert({
        where: { id: record.familyId },
        create: {
          id: record.familyId,
          userId: record.userId,
          familyExpiresAt: record.familyExpiresAt,
        },
        update: {},
      });

      await tx.refreshToken.create({
        data: {
          id: record.id,
          familyId: record.familyId,
          userId: record.userId,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
          familyExpiresAt: record.familyExpiresAt,
          usedAt: record.usedAt ?? null,
          revoked: false,
          claims: (record.claims as Prisma.InputJsonValue) ?? undefined,
        },
      });
    });
  }

  async markRefreshTokenUsed(id: string, at: Date): Promise<boolean> {
    // One conditional writing a read followed by update is unsafe under races.
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, usedAt: null, user: { deletedAt: null } },
      data: { usedAt: at },
    });

    return result.count === 1;
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    // Keep revocation on token rows as well as the family tombstone. This
    // makes isRefreshTokenFamilyRevoked() correct even when tokens are read
    // independently of the family table, and mirrors the package's contract.
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshTokenFamily.updateMany({
        where: { id: familyId },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { familyId },
        data: { revoked: true },
      });
    });
  }

  async isRefreshTokenFamilyRevoked(familyId: string): Promise<boolean> {
    const [family, revokedToken] = await Promise.all([
      this.prisma.refreshTokenFamily.findUnique({
        where: { id: familyId },
        select: authRefreshTokenFamilyRevocationSelect,
      }),
      this.prisma.refreshToken.findFirst({
        where: { familyId, revoked: true },
        select: authRevokedRefreshTokenSelect,
      }),
    ]);

    return Boolean(family?.revokedAt) || revokedToken !== null;
  }

  async revokeUserRefreshTokens(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshTokenFamily.updateMany({
        where: { userId },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { userId },
        data: { revoked: true },
      });
    });
  }

  async saveEmailToken(record: EmailTokenRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Serialize email-token saves across database connections.
      await tx.$queryRaw<Array<{ lock: string }>>`
  SELECT pg_advisory_xact_lock(1197030721, 1)::text AS lock
`;
      await tx.emailToken.create({
        data: {
          id: record.id,
          purpose: record.purpose,
          userId: record.userId,
          email: record.email,
          fingerprint: record.fingerprint ?? null,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
        },
      });

      await tx.emailToken.deleteMany({
        where: {
          expiresAt: { lte: record.createdAt },
        },
      });

      const cutoff = await tx.emailToken.findMany({
        select: authPendingEmailTokenCutoffSelect,
        orderBy: [{ expiresAt: 'desc' }, { id: 'desc' }],
        skip: this.maxPending,
        take: 1,
      });

      if (cutoff[0]) {
        await tx.emailToken.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: cutoff[0].expiresAt } },
              {
                expiresAt: cutoff[0].expiresAt,
                id: { lte: cutoff[0].id },
              },
            ],
          },
        });
      }
    });
  }

  async consumeEmailToken(
    id: string,
    purpose: EmailTokenPurpose,
  ): Promise<EmailTokenRecord | undefined> {
    // DELETE ... RETURNING is atomic: a concurrent request cannot consume the
    // same link, and a purpose mismatch leaves the token untouched.
    const rows = await this.prisma.$queryRaw<Array<AuthConsumedEmailTokenRow>>DELETE FROM "email_tokens"
      WHERE "id" = ${id} AND "purpose" = ${purpose}
      RETURNING "id", "purpose", "user_id" AS "userId", "email",
                "fingerprint", "created_at" AS "createdAt",
                "expires_at" AS "expiresAt"`;

    const row = rows[0];
    return row ? toEmailTokenRecord(row) : undefined;
  }

  async deleteUserEmailTokens(
    userId: string,
    purpose: EmailTokenPurpose,
  ): Promise<void> {
    await this.prisma.emailToken.deleteMany({ where: { userId, purpose } });
  }

  async deleteExpiredRefreshTokens(now = new Date()): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.deleteMany({
        where: {
          familyExpiresAt: { lte: now },
        },
      });

      await tx.refreshTokenFamily.deleteMany({
        where: {
          familyExpiresAt: { lte: now },
          refreshTokens: {
            none: {},
          },
        },
      });
    });
  }

  async deleteExpiredEmailTokens(now = new Date()): Promise<void> {
    await this.prisma.emailToken.deleteMany({
      where: {
        expiresAt: { lte: now },
      },
    });
  }
}
