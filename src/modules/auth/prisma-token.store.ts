import { Injectable } from '@nestjs/common';
import {
  AuthenticationStorage,
  type EmailTokenPurpose,
  type EmailTokenRecord,
  type EmailTokenStore,
  type RefreshTokenRecord,
  type RefreshTokenStore,
} from '@nestjs/authentication';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/index.js';

const MAX_PENDING_EMAIL_TOKENS = 10_000;

/** PostgreSQL-backed stores for opaque refresh tokens and email links. */
@Injectable()
export class PrismaTokenStore implements RefreshTokenStore, EmailTokenStore {
  constructor(
    private readonly prisma: PrismaService,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({ refreshTokens: this, emailTokens: this });
  }

  async getRefreshToken(id: string): Promise<RefreshTokenRecord | undefined> {
    const row = await this.prisma.refreshToken.findUnique({ where: { id } });
    if (!row) return undefined;

    return {
      id: row.id,
      familyId: row.familyId,
      userId: row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      familyExpiresAt: row.familyExpiresAt,
      ...(row.usedAt !== null ? { usedAt: row.usedAt } : {}),
      ...(row.claims !== null
        ? { claims: row.claims as Record<string, unknown> }
        : {}),
    };
  }

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Keep storage bounded. Delete child tokens before their family rows.
      await tx.refreshToken.deleteMany({
        where: { familyExpiresAt: { lte: record.createdAt } },
      });
      await tx.refreshTokenFamily.deleteMany({
        where: { familyExpiresAt: { lte: record.createdAt } },
      });

      // Never reset revokedAt on an existing family: a racing refresh must not
      // resurrect a family that another request has already revoked.
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
          claims: (record.claims as Prisma.InputJsonValue) ?? undefined,
        },
      });
    });
  }

  async markRefreshTokenUsed(id: string, at: Date): Promise<boolean> {
    // One conditional write; a read followed by update is unsafe under races.
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: at },
    });
    return result.count === 1;
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    // Revocation lives on the family row, so it also covers successor tokens
    // saved after a concurrent refresh request.
    await this.prisma.refreshTokenFamily.updateMany({
      where: { id: familyId },
      data: { revokedAt: new Date() },
    });
  }

  async isRefreshTokenFamilyRevoked(familyId: string): Promise<boolean> {
    const family = await this.prisma.refreshTokenFamily.findUnique({
      where: { id: familyId },
      select: { revokedAt: true },
    });
    return family ? family.revokedAt !== null : false;
  }

  async revokeUserRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshTokenFamily.updateMany({
      where: { userId },
      data: { revokedAt: new Date() },
    });
  }

  async saveEmailToken(record: EmailTokenRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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

      // Use the record's clock, so tests and the auth service share a clock.
      await tx.emailToken.deleteMany({
        where: { expiresAt: { lte: record.createdAt } },
      });

      const cutoff = await tx.emailToken.findMany({
        select: { expiresAt: true },
        orderBy: [{ expiresAt: 'desc' }, { id: 'desc' }],
        skip: MAX_PENDING_EMAIL_TOKENS,
        take: 1,
      });

      if (cutoff[0]) {
        await tx.emailToken.deleteMany({
          where: { expiresAt: { lte: cutoff[0].expiresAt } },
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
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        purpose: string;
        userId: string;
        email: string;
        fingerprint: string | null;
        createdAt: Date;
        expiresAt: Date;
      }>
    >`DELETE FROM "email_tokens"
      WHERE "id" = ${id} AND "purpose" = ${purpose}
      RETURNING "id", "purpose", "user_id" AS "userId", "email",
                "fingerprint", "created_at" AS "createdAt",
                "expires_at" AS "expiresAt"`;

    const row = rows[0];
    if (!row) return undefined;

    return {
      id: row.id,
      purpose: row.purpose as EmailTokenPurpose,
      userId: row.userId,
      email: row.email,
      ...(row.fingerprint !== null ? { fingerprint: row.fingerprint } : {}),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  async deleteUserEmailTokens(
    userId: string,
    purpose: EmailTokenPurpose,
  ): Promise<void> {
    await this.prisma.emailToken.deleteMany({ where: { userId, purpose } });
  }
}
