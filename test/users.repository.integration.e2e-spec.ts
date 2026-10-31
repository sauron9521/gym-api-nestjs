import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UsersModule } from '../src/modules/index.js';

import { UsersRepository } from '../src/modules/users/users.repository.js';
import { PrismaModule, PrismaService } from '../src/prisma/index.js';
import { useTestDatabase } from './utility/test-db-helper.js';

describe('UsersRepository integration (e2e)', () => {
  let app: INestApplication;
  let repository: UsersRepository;
  let prisma: PrismaService;

  const emailPrefix = `users-repo-${randomUUID()}`;
  const emails: string[] = [];

  const passwordHash = 'test-password-hash';
  const updatedPasswordHash = 'updated-test-password-hash';

  function createEmail(suffix: string): string {
    const email = `${emailPrefix}-${suffix}@example.com`;
    emails.push(email);
    return email;
  }

  async function createUser(email: string) {
    return repository.create(email, passwordHash);
  }

  beforeAll(async () => {
    // const testDatabaseUrl = process.env.TEST_DATABASE_URL;
    //
    // if (!testDatabaseUrl) {
    //   throw new Error(
    //     'TEST_DATABASE_URL must point to a dedicated test database.',
    //   );
    // }
    //
    // let databaseName: string;
    //
    // try {
    //   databaseName = decodeURIComponent(
    //     new URL(testDatabaseUrl).pathname.slice(1),
    //   );
    // } catch {
    //   throw new Error('TEST_DATABASE_URL is not a valid database URL.');
    // }
    //
    // if (!databaseName.toLowerCase().includes('test')) {
    //   throw new Error(
    //     'Refusing to run integration tests: database name must contain "test".',
    //   );
    // }
    //
    // // Use the test DB before Nest initializes PrismaService.
    // process.env.DATABASE_URL = testDatabaseUrl;
    useTestDatabase();

    const moduleRef = await Test.createTestingModule({
      imports: [
        await ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        UsersModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    await app.init();

    repository = app.get(UsersRepository);
    prisma = app.get(PrismaService);
  }, 20_000);

  afterAll(async () => {
    try {
      if (prisma && emails.length > 0) {
        await prisma.user.deleteMany({
          where: {
            email: { in: emails },
          },
        });
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  }, 20_000);

  it('creates a user without exposing the password hash', async () => {
    const email = createEmail('create');

    const result = await createUser(email);

    expect(result.email).toBe(email);
    expect(result).not.toHaveProperty('passHash');

    const savedUser = await prisma.user.findUnique({
      where: { email },
    });

    expect(savedUser).not.toBeNull();
    expect(savedUser?.passwordHash).toBe(passwordHash);
  });

  it('finds a user by email and ID without exposing the hash', async () => {
    const email = createEmail('find');

    const created = await createUser(email);

    const byEmail = await repository.findUserByEmail(email);
    const byId = await repository.findUserById(created.id);

    expect(byEmail?.id).toBe(created.id);
    expect(byEmail?.email).toBe(email);
    expect(byEmail).not.toHaveProperty('passwordHash');

    expect(byId?.id).toBe(created.id);
    expect(byId).not.toHaveProperty('passwordHash');
  });

  it('returns null when the user does not exist', async () => {
    await expect(
      repository.findUserByEmail('missing-user@example.com'),
    ).resolves.toBeNull();

    await expect(repository.findUserById(randomUUID())).resolves.toBeNull();
  });

  it('returns credentials including the password hash', async () => {
    const email = createEmail('credentials');

    await createUser(email);

    const credentials = await repository.findCredentials(email);

    expect(credentials).not.toBeNull();
    expect(credentials?.email).toBe(email);
    expect(credentials?.passwordHash).toBe(passwordHash);
  });

  it('returns null when credentials are not found', async () => {
    const credentials = await repository.findCredentials(
      'missing-credentials@example.com',
    );

    expect(credentials).toBeNull();
  });

  it('updates the password hash in the database', async () => {
    const email = createEmail('update-hash');

    const user = await createUser(email);

    await repository.updatePassHash(user.id, updatedPasswordHash);

    const updated = await prisma.user.findUnique({
      where: { id: user.id },
    });

    expect(updated?.passwordHash).toBe(updatedPasswordHash);
  });

  it('checks whether an email is already registered', async () => {
    const email = createEmail('check-email');

    await createUser(email);

    await expect(repository.checkEmail(email)).rejects.toThrow(
      ConflictException,
    );

    await expect(
      repository.checkEmail('available@example.com'),
    ).resolves.toBeUndefined();
  });

  it('marks email as verified when the ID and email match', async () => {
    const email = createEmail('verify');

    const user = await createUser(email);

    expect(user.emailVerified).toBe(false);

    const result = await repository.markEmailVerified(user.id, email);

    expect(result).toBe(true);

    const updated = await prisma.user.findUnique({
      where: { id: user.id },
    });

    expect(updated?.emailVerified).toBe(true);
  });

  it('does not verify an email that does not match the user', async () => {
    const email = createEmail('wrong-email');

    const user = await createUser(email);

    const result = await repository.markEmailVerified(
      user.id,
      'different@example.com',
    );

    expect(result).toBe(false);

    const unchanged = await prisma.user.findUnique({
      where: { id: user.id },
    });

    expect(unchanged?.emailVerified).toBe(false);
  });

  it('does not return a soft-deleted user for authentication', async () => {
    const email = createEmail('soft-delete');
    const user = await createUser(email);

    await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });

    await expect(repository.findUserById(user.id)).resolves.toBeNull();
    await expect(repository.findCredentials(email)).resolves.toBeNull();

    // Soft delete must preserve the database record.
    const deletedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, deletedAt: true },
    });

    expect(deletedUser).not.toBeNull();
    expect(deletedUser?.deletedAt).toBeInstanceOf(Date);
  });
});
