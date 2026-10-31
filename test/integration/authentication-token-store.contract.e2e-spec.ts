import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AuthenticationStorage,
  type EmailTokenStore,
  type RefreshTokenStore,
} from '@nestjs/authentication';
import { authenticationStoreContract } from '@nestjs/authentication/testing';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { PrismaService } from '../../src/database/index.js';
import { PrismaTokenStore } from '../../src/modules/auth/stores/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

const contractNamespace = randomUUID();
const contractEmailDomain = `contract-${contractNamespace}.test`;

let app: INestApplication;
let prisma: PrismaService;

async function createTokenStores() {
  const storage = new AuthenticationStorage();
  const store = new PrismaTokenStore(prisma, storage);

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
  });

  for (const contract of cases) {
    it(contract.name, () => contract.run);
  }
});
