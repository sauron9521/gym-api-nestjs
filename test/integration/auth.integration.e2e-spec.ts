import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Mailer } from '@nestjs/mail';

import { AppModule } from '../../src/app.module.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/prisma/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';

describe('Authentication integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const email = `integration-${randomUUID()}@example.com`;
  const password = 'StrongGym123!';

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
    // // PrismaService використовує саме DATABASE_URL.
    // // Підміняємо її URL-адресою окремої тестової БД.
    // process.env.DATABASE_URL = testDatabaseUrl;

    useTestDatabase();

    // Потрібне для конфігурації AuthenticationModule.
    process.env.APP_URL ??= 'http://localhost:3000';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(Mailer)
      .useValue({
        send: vi.fn().mockResolvedValue(undefined),
      })
      .compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();

    prisma = app.get(PrismaService);
  }, 20_000);

  afterAll(async () => {
    try {
      if (prisma) {
        // Видаляємо лише користувача, створеного цим тестом.
        await prisma.user.deleteMany({
          where: { email },
        });
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  }, 20_000);

  it('registers a user, stores a password hash, rejects duplicates and authenticates credentials', async () => {
    // 1. Реєстрація через HTTP.
    const signUpResponse = await request(app.getHttpServer())
      .post('/auth/registry')
      .send({ email, password });

    expect(signUpResponse.status).toBe(201);
    expect(signUpResponse.body).toHaveProperty('id');
    expect(signUpResponse.body.email).toBe(email);
    expect(signUpResponse.body).not.toHaveProperty('passwordHash');
    expect(signUpResponse.body).not.toHaveProperty('password');

    // 2. Перевіряємо, що користувач справді збережений у PostgreSQL.
    const savedUser = await prisma.user.findUnique({
      where: { email },
    });

    expect(savedUser).not.toBeNull();
    expect(savedUser?.email).toBe(email);
    expect(savedUser?.passwordHash).toBeTruthy();
    expect(savedUser?.passwordHash).not.toBe(password);

    // 3. Повторна реєстрація з тією самою адресою.
    const duplicateResponse = await request(app.getHttpServer())
      .post('/auth/registry')
      .send({ email, password });

    expect(duplicateResponse.status).toBe(409);

    // 4. Неправильний пароль.
    const invalidSignInResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email,
        password: 'WrongGym123!',
      });

    expect(invalidSignInResponse.status).toBe(401);

    // 5. Правильний пароль.
    const validSignInResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });

    expect(validSignInResponse.status).toBe(200);
    expect(validSignInResponse.body).toHaveProperty('mfaRequired', false);
  }, 20_000);
});
