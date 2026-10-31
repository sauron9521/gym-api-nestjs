import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  AuthenticationStorage,
  type EmailTokenPurpose,
  type EmailTokenRecord,
  type EmailTokenStore,
  type RefreshTokenRecord,
  type RefreshTokenStore,
} from '@nestjs/authentication';
import { authenticationStoreContract } from '@nestjs/authentication/testing';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaTokenStore } from '../../src/modules/auth/stores/index.js';
import { PrismaModule, PrismaService } from '../../src/database/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

let app: INestApplication;
let prisma: PrismaService;
let store: PrismaTokenStore;
const testUserIds = new Set<string>();

class ContractTokenStore implements RefreshTokenStore, EmailTokenStore {
  constructor(
    private readonly persistence: PrismaTokenStore,
    private readonly db: PrismaService,
  ) {}

  getRefreshToken(id: string) {
    return this.persistence.getRefreshToken(id);
  }

  async saveRefreshToken(record: RefreshTokenRecord) {
    await this.ensureUser(record.userId);
    await this.persistence.saveRefreshToken(record);
  }

  markRefreshTokenUsed(id: string, at: Date) {
    return this.persistence.markRefreshTokenUsed(id, at);
  }

  revokeRefreshTokenFamily(familyId: string) {
    return this.persistence.revokeRefreshTokenFamily(familyId);
  }

  isRefreshTokenFamilyRevoked(familyId: string) {
    return this.persistence.isRefreshTokenFamilyRevoked(familyId);
  }

  revokeUserRefreshTokens(userId: string) {
    return this.persistence.revokeUserRefreshTokens(userId);
  }

  async saveEmailToken(record: EmailTokenRecord) {
    await this.ensureUser(record.userId);
    await this.persistence.saveEmailToken(record);
  }

  consumeEmailToken(id: string, purpose: EmailTokenPurpose) {
    return this.persistence.consumeEmailToken(id, purpose);
  }

  deleteUserEmailTokens(userId: string, purpose: EmailTokenPurpose) {
    return this.persistence.deleteUserEmailTokens(userId, purpose);
  }

  private async ensureUser(userId: string): Promise<void> {
    const emailHash = createHash('sha256').update(userId).digest('hex');
    await this.db.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: `${emailHash}@token-contract.invalid`,
        passwordHash: 'contract-test-password-hash',
      },
      update: {},
      select: { id: true },
    });
    testUserIds.add(userId);
  }
}

const contractCases = authenticationStoreContract(
  async () => {
    if (!store || !prisma) {
      throw new Error(
        'Test database and PrismaTokenStore must be initialized.',
      );
    }
    const adapter = new ContractTokenStore(store, prisma);
    return { refreshTokens: adapter, emailTokens: adapter };
  },
  { contracts: ['refreshTokens', 'emailTokens'], concurrent: true },
);

describe('PrismaTokenStore integration (e2e)', () => {
  beforeAll(async () => {
    useTestDatabase();

    const moduleRef = await Test.createTestingModule({
      imports: [await ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
      providers: [AuthenticationStorage, PrismaTokenStore],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    store = app.get(PrismaTokenStore);
  }, 20_000);

  afterAll(async () => {
    try {
      if (prisma && testUserIds.size > 0) {
        // User FK cascade removes token rows and family rows.
        await prisma.user.deleteMany({
          where: { id: { in: [...testUserIds] } },
        });
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  for (const contractCase of contractCases) {
    it(contractCase.name, () => contractCase.run());
  }

  it('keeps a family revoked when a successor is saved afterward', async () => {
    const userId = `token-family-${randomUUID()}`;
    const email = `${createHash('sha256').update(userId).digest('hex')}@token-family.invalid`;
    await prisma.user.create({
      data: { id: userId, email, passwordHash: 'test-password-hash' },
      select: { id: true },
    });
    testUserIds.add(userId);

    const now = new Date();
    const familyId = randomUUID().replaceAll('-', '');
    const original: RefreshTokenRecord = {
      id: createHash('sha256').update(randomUUID()).digest('hex'),
      familyId,
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      familyExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
    };
    await store.saveRefreshToken(original);
    await store.revokeRefreshTokenFamily(familyId);

    const successor: RefreshTokenRecord = {
      ...original,
      id: createHash('sha256').update(randomUUID()).digest('hex'),
      createdAt: new Date(now.getTime() + 1),
      expiresAt: new Date(now.getTime() + 60_001),
    };
    await store.saveRefreshToken(successor);

    await expect(store.isRefreshTokenFamilyRevoked(familyId)).resolves.toBe(
      true,
    );
    await expect(store.getRefreshToken(successor.id)).resolves.toMatchObject({
      id: successor.id,
      familyId,
    });
  });

  it('deletes expired email tokens during cleanup', async () => {
    const userId = `email-cleanup-${randomUUID()}`;
    const email = `${createHash('sha256').update(userId).digest('hex')}@email-cleanup.invalid`;

    await prisma.user.create({
      data: {
        id: userId,
        email,
        passwordHash: 'test-password-hash',
      },
      select: { id: true },
    });

    testUserIds.add(userId);

    const now = new Date('2023-11-14T22:13:20.000Z');

    const expiredToken: EmailTokenRecord = {
      id: randomUUID().replaceAll('-', ''),
      purpose: 'password-reset',
      userId,
      email,
      fingerprint: 'expired-fingerprint',
      createdAt: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() - 1_000),
    };

    const validToken: EmailTokenRecord = {
      id: randomUUID().replaceAll('-', ''),
      purpose: 'password-reset',
      userId,
      email,
      fingerprint: 'valid-fingerprint',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    };

    await store.saveEmailToken(expiredToken);
    await store.saveEmailToken(validToken);

    await store.deleteExpiredEmailTokens(now);

    await expect(
      store.consumeEmailToken(expiredToken.id, 'password-reset'),
    ).resolves.toBeUndefined();

    await expect(
      store.consumeEmailToken(validToken.id, 'password-reset'),
    ).resolves.toMatchObject({
      id: validToken.id,
      userId,
    });
  });
});
