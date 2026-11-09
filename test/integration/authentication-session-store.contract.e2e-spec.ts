import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { AuthenticationStorage } from '@nestjs/authentication';
import { authenticationStoreContract } from '@nestjs/authentication/testing';
import { afterAll, beforeAll, describe, it } from 'vitest';

import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/infra/database/index.js';
import { PrismaSessionStore } from '../../src/modules/auth/stores/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

const contractNamespace = randomUUID();
const contractEmailDomain = `contract-${contractNamespace}.test`;

let app: INestApplication;
let prisma: PrismaService;

async function createSessionStore() {
  const store = new PrismaSessionStore(prisma, new AuthenticationStorage());

  return {
    sessions: {
      getSession: (id: string) => store.getSession(id),

      createSession: async (
        record: Parameters<typeof store.createSession>[0],
      ) => {
        // Session має FK на User, тому створюємо тестового власника.
        await prisma.user.upsert({
          where: { id: record.userId },
          create: {
            id: record.userId,
            email: `${record.userId}@${contractEmailDomain}`,
            passwordHash: 'contract-test-hash',
          },
          update: {},
        });

        await store.createSession(record);
      },

      touchSession: (id: string, lastActiveAt: Date) =>
        store.touchSession(id, lastActiveAt),

      deleteSession: (id: string) => store.deleteSession(id),

      listUserSessions: (userId: string) => store.listUserSessions(userId),

      deleteUserSessions: (userId: string) => store.deleteUserSessions(userId),
    },
  };
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

describe('PrismaSessionStore contract (PostgreSQL)', () => {
  const cases = authenticationStoreContract(createSessionStore, {
    contracts: ['sessions'],
    concurrent: true,
  });

  for (const contract of cases) {
    it(contract.name, () => contract.run());
  }
});
