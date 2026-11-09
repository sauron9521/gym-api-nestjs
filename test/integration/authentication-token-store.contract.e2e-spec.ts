import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AuthenticationStorage,
  EmailTokenRecord,
  type EmailTokenStore,
  type RefreshTokenStore,
} from '@nestjs/authentication';
import { authenticationStoreContract } from '@nestjs/authentication/testing';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { PrismaService } from '../../src/infra/database/index.js';
import { PrismaTokenStore } from '../../src/modules/auth/stores/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

const contractNamespace = randomUUID();
const contractEmailDomain = `contract-${contractNamespace}.test`;

let app: INestApplication;
let prisma: PrismaService;

class ContractPrismaTokenStore extends PrismaTokenStore {
  protected override readonly maxPending = 3;
}

async function createTokenStores() {
  await prisma.emailToken.deleteMany();

  const storage = new AuthenticationStorage();
  const store = new ContractPrismaTokenStore(prisma, storage);

  // RefreshTokenFamily, RefreshToken та EmailToken мають FK на User.
  async function ensureUser(userId: string): Promise<void> {
    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: `${userId}@${contractEmailDomain}`,
        passwordHash: 'contract-test-hash',
      },
      update: {},
    });
  }

  const refreshTokens: RefreshTokenStore = {
    getRefreshToken: (id) => store.getRefreshToken(id),

    saveRefreshToken: async (record) => {
      await ensureUser(record.userId);
      await store.saveRefreshToken(record);
    },

    markRefreshTokenUsed: (id, at) => store.markRefreshTokenUsed(id, at),

    revokeRefreshTokenFamily: (familyId) =>
      store.revokeRefreshTokenFamily(familyId),

    isRefreshTokenFamilyRevoked: (familyId) =>
      store.isRefreshTokenFamilyRevoked(familyId),

    revokeUserRefreshTokens: (userId) => store.revokeUserRefreshTokens(userId),
  };

  const emailTokens: EmailTokenStore = {
    saveEmailToken: async (record) => {
      await ensureUser(record.userId);
      await store.saveEmailToken(record);
    },

    consumeEmailToken: (id, purpose) => store.consumeEmailToken(id, purpose),

    deleteUserEmailTokens: (userId, purpose) =>
      store.deleteUserEmailTokens(userId, purpose),
  };

  return { refreshTokens, emailTokens };
}

beforeAll(async () => {
  useTestDatabase();

  const { AppModule } = await import('../../src/app.module.js');

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleFixture.createNestApplication();
  await app.init();

  prisma = app.get(PrismaService);
}, 30_000);

afterAll(async () => {
  try {
    await prisma?.user.deleteMany({
      where: {
        email: {
          endsWith: `@${contractEmailDomain}`,
        },
      },
    });
  } finally {
    await app?.close();
  }
}, 20_000);

describe('PrismaTokenStore contract (PostgreSQL)', () => {
  const cases = authenticationStoreContract(createTokenStores, {
    contracts: ['refreshTokens', 'emailTokens'],
    concurrent: true,
    maxPending: 3,
  });

  for (const contract of cases) {
    it(contract.name, () => contract.run());
  }

  it('keeps maxPending email tokens when saves happen concurrently', async () => {
    const { emailTokens } = await createTokenStores();

    const createdAt = new Date('2026-10-31T12:00:00.000Z');

    const records: EmailTokenRecord[] = Array.from(
      { length: 12 },
      (_, index) => {
        const userId = `user-${randomUUID()}`;

        return {
          id: randomUUID().replaceAll('-', ''),
          purpose: 'password-reset',
          userId,
          email: `${userId}@${contractEmailDomain}`,
          fingerprint: `fingerprint-${index}`,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + (index + 1) * 60_000),
        };
      },
    );

    // Усі 12 записів надсилаємо одночасно.
    await Promise.all(
      records.map((record) => emailTokens.saveEmailToken(record)),
    );

    const persisted = await prisma.emailToken.findMany({
      where: {
        userId: {
          in: records.map((record) => record.userId),
        },
      },
      select: {
        id: true,
        expiresAt: true,
      },
      orderBy: [{ expiresAt: 'desc' }, { id: 'desc' }],
    });

    // Має залишитися рівно 3 токени з найдовшим терміном дії.
    expect(persisted).toHaveLength(3);

    const persistedIds = persisted
      .map((record) => record.id)
      .sort((a, b) => a.localeCompare(b));

    const expectedIds = records
      .slice(-3)
      .map((record) => record.id)
      .sort((a, b) => a.localeCompare(b));

    expect(persistedIds).toEqual(expectedIds);
  });
});
