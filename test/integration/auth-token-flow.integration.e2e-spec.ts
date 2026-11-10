import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { PrismaService } from '../../src/infra/database/index.js';
import { useTestDatabase } from '../utility/test-db-helper.js';
import { ThrottlerGuard } from '@nestjs/throttler';

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

const password = 'StrongPassword123!';
const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  APP_URL: process.env.APP_URL,
  JWT_SECRET: process.env.JWT_SECRET,
};

let app: INestApplication;
let prisma: PrismaService;
let passwordHasher: PasswordHasher;
let userId = '';
let email: string;

async function issueTokenPair(): Promise<TokenPair> {
  const response = await request(app.getHttpServer())
    .post('/auth/token')
    .send({ email, password });

  expect(response.status).toBe(200);
  expect(response.body).toEqual(
    expect.objectContaining({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: expect.any(Number),
    }),
  );

  return response.body as TokenPair;
}

async function expectRefreshUnauthorized(refreshToken: string): Promise<void> {
  await request(app.getHttpServer())
    .post('/auth/token/refresh')
    .send({ refreshToken })
    .expect(401);
}

describe('Auth token flow (HTTP + PostgreSQL)', () => {
  beforeAll(async () => {
    useTestDatabase();

    process.env.APP_URL ||= 'http://localhost:3000';
    if (
      !process.env.JWT_SECRET ||
      Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32
    ) {
      process.env.JWT_SECRET = randomUUID() + randomUUID();
    }

    const { AppModule } = await import('../../src/app.module.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();

    prisma = app.get(PrismaService);
    passwordHasher = app.get(PasswordHasher);
  }, 30_000);

  beforeEach(async () => {
    email = `auth-flow-${randomUUID()}@example.com`;
    const passwordHash = await passwordHasher.hash(password);
    const user = await prisma.user.create({
      data: { email, passwordHash },
      select: { id: true },
    });
    userId = user.id;
  });

  afterEach(async () => {
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
      userId = '';
    }
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      if (originalEnv.DATABASE_URL === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalEnv.DATABASE_URL;
      }

      if (originalEnv.APP_URL === undefined) {
        delete process.env.APP_URL;
      } else {
        process.env.APP_URL = originalEnv.APP_URL;
      }

      if (originalEnv.JWT_SECRET === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = originalEnv.JWT_SECRET;
      }
    }
  }, 20_000);

  it('rotates a refresh token and revokes its whole family when the old token is reused', async () => {
    const initial = await issueTokenPair();

    // Verify that the real bearer provider accepts the access token returned
    // by TokenService, rather than only checking a mocked controller result.
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${initial.accessToken}`)
      .expect(200);

    const refreshResponse = await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken: initial.refreshToken })
      .expect(200);

    const rotated = refreshResponse.body as TokenPair;
    expect(rotated.accessToken).not.toBe(initial.accessToken);
    expect(rotated.refreshToken).not.toBe(initial.refreshToken);

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${rotated.accessToken}`)
      .expect(200);

    // Reusing the spent token is treated as token theft and revokes successors.
    await expectRefreshUnauthorized(initial.refreshToken);
    await expectRefreshUnauthorized(rotated.refreshToken);

    const families = await prisma.refreshTokenFamily.findMany({
      where: { userId },
      select: { revokedAt: true },
    });
    expect(families).toHaveLength(1);
    expect(families[0]?.revokedAt).toBeInstanceOf(Date);

    const storedTokens = await prisma.refreshToken.findMany({
      where: { userId },
      select: { usedAt: true },
    });
    expect(storedTokens).toHaveLength(2);
    expect(storedTokens.filter((token) => token.usedAt !== null)).toHaveLength(
      1,
    );
  });

  it('revokes the refresh-token family through the HTTP revoke endpoint', async () => {
    const tokens = await issueTokenPair();

    await request(app.getHttpServer())
      .post('/auth/token/revoke')
      .send({ refreshToken: tokens.refreshToken })
      .expect(204);

    await expectRefreshUnauthorized(tokens.refreshToken);

    const family = await prisma.refreshTokenFamily.findFirst({
      where: { userId },
      select: { revokedAt: true },
    });
    expect(family?.revokedAt).toBeInstanceOf(Date);
  });

  it('revokes all refresh-token families through the authenticated sign-out-everywhere endpoint', async () => {
    const tokens = await issueTokenPair();

    await request(app.getHttpServer())
      .post('/auth/sign-out-everywhere')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(204);

    await expectRefreshUnauthorized(tokens.refreshToken);

    const families = await prisma.refreshTokenFamily.findMany({
      where: { userId },
      select: { revokedAt: true },
    });
    expect(families).toHaveLength(1);
    expect(families[0]?.revokedAt).toBeInstanceOf(Date);

    // Existing access JWTs are stateless and remain valid until their short TTL
    // expires; sign-out-everywhere revokes sessions and refresh-token families.
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
  });

  it('revoking one login family does not invalidate another login for the same user', async () => {
    const first = await issueTokenPair();
    const second = await issueTokenPair();

    const familiesBefore = await prisma.refreshTokenFamily.findMany({
      where: { userId },
      select: { revokedAt: true },
    });
    expect(familiesBefore).toHaveLength(2);
    expect(familiesBefore.every((family) => family.revokedAt === null)).toBe(
      true,
    );

    await request(app.getHttpServer())
      .post('/auth/token/revoke')
      .send({ refreshToken: first.refreshToken })
      .expect(204);

    await expectRefreshUnauthorized(first.refreshToken);

    const otherLogin = await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken: second.refreshToken })
      .expect(200);

    expect(otherLogin.body.refreshToken).not.toBe(second.refreshToken);
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${otherLogin.body.accessToken}`)
      .expect(200);

    const familiesAfter = await prisma.refreshTokenFamily.findMany({
      where: { userId },
      select: { revokedAt: true },
    });
    expect(familiesAfter.filter((family) => family.revokedAt !== null)).toHaveLength(1);
    expect(familiesAfter.filter((family) => family.revokedAt === null)).toHaveLength(1);
  });

  it('replaying one rotated token never revokes an unrelated login family', async () => {
    const compromised = await issueTokenPair();
    const independent = await issueTokenPair();

    const response = await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken: compromised.refreshToken })
      .expect(200);

    const rotated = response.body as TokenPair;
    expect(rotated.refreshToken).not.toBe(compromised.refreshToken);

    // Reuse must quarantine only the compromised token family.
    await expectRefreshUnauthorized(compromised.refreshToken);
    await expectRefreshUnauthorized(rotated.refreshToken);

    const otherLogin = await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken: independent.refreshToken })
      .expect(200);

    expect(otherLogin.body.refreshToken).not.toBe(independent.refreshToken);

    const families = await prisma.refreshTokenFamily.findMany({
      where: { userId },
      select: { revokedAt: true },
    });
    expect(families).toHaveLength(2);
    expect(families.filter((family) => family.revokedAt !== null)).toHaveLength(1);
    expect(families.filter((family) => family.revokedAt === null)).toHaveLength(1);
  });

  it('rejects token issuance, refresh and bearer access after the owner is soft-deleted', async () => {
    const tokens = await issueTokenPair();

    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
      select: { id: true },
    });

    await request(app.getHttpServer())
      .post('/auth/token')
      .send({ email, password })
      .expect(401);

    await expectRefreshUnauthorized(tokens.refreshToken);

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(401);

    // Soft deletion denies authentication without silently deleting audit rows.
    expect(await prisma.refreshToken.count({ where: { userId } })).toBe(1);
    expect(await prisma.refreshTokenFamily.count({ where: { userId } })).toBe(1);
  });

  it('should reject an empty password when issuing tokens', async () => {
    await request(app.getHttpServer())
      .post('/auth/token')
      .send({
        email,
        password: '',
      })
      .expect(400);
  });

  it('should reject a whitespace-only password when issuing tokens', async () => {
    await request(app.getHttpServer())
      .post('/auth/token')
      .send({
        email,
        password: '   ',
      })
      .expect(400);
  });
});
