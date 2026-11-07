import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { StandardSchemaValidationPipe, ValidationPipe } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';
import { PasswordHasher } from '@nestjs/authentication';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';

import request from 'supertest';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/index.js';
import { useTestDatabase } from './utility/test-db-helper.js';

describe('TrainerAthletes (HTTP + PostgreSQL)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  let passwordHasher: PasswordHasher;

  type TestUser = {
    id: string;
    email: string;
  };

  let trainerOne: TestUser;
  let trainerTwo: TestUser;
  let athleteOne: TestUser;
  let athleteTwo: TestUser;
  let outsider: TestUser;

  let trainerOneCookie: string;
  let trainerTwoCookie: string;
  let athleteOneCookie: string;
  let athleteTwoCookie: string;
  let outsiderCookie: string;

  let trainerInitiatedRelationshipId: string;
  let athleteInitiatedRelationshipId: string;
  let declinedRelationshipId: string;

  const userIds: string[] = [];

  const password = 'StrongPassword123!';

  function extractSessionCookie(header: string | string[] | undefined): string {
    const cookies = Array.isArray(header) ? header : header ? [header] : [];

    const cookie = cookies
      .map((value) => value.split(';', 1)[0] ?? '')
      .find((value) => value.startsWith('__Host-sid='));

    if (!cookie) {
      throw new Error('Session cookie was not set.');
    }

    return cookie;
  }

  async function login(email: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({
        email,
        password,
      });

    expect(response.status).toBe(200);

    return extractSessionCookie(response.headers['set-cookie']);
  }

  async function createUser(
    email: string,
    role: 'TRAINER' | 'ATHLETE',
  ): Promise<TestUser> {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await passwordHasher.hash(password),
        role,
      },
      select: {
        id: true,
        email: true,
      },
    });

    userIds.push(user.id);

    return user;
  }

  beforeAll(async () => {
    // Never allow these tests to connect to the development database.
    useTestDatabase();

    const moduleRef = await Test.createTestingModule({
      imports: [await ConfigModule.forRoot({ isGlobal: true }), AppModule],
    })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
      new StandardSchemaValidationPipe(),
    );

    await app.init();

    prisma = app.get(PrismaService);
    passwordHasher = app.get(PasswordHasher);

    trainerOne = await createUser(
      `trainer-one-${randomUUID()}@example.com`,
      'TRAINER',
    );

    trainerTwo = await createUser(
      `trainer-two-${randomUUID()}@example.com`,
      'TRAINER',
    );

    athleteOne = await createUser(
      `athlete-one-${randomUUID()}@example.com`,
      'ATHLETE',
    );

    athleteTwo = await createUser(
      `athlete-two-${randomUUID()}@example.com`,
      'ATHLETE',
    );

    outsider = await createUser(
      `outsider-${randomUUID()}@example.com`,
      'ATHLETE',
    );

    trainerOneCookie = await login(trainerOne.email);
    trainerTwoCookie = await login(trainerTwo.email);
    athleteOneCookie = await login(athleteOne.email);
    athleteTwoCookie = await login(athleteTwo.email);
    outsiderCookie = await login(outsider.email);
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma && userIds.length > 0) {
        // Remove relationship history before deleting referenced users.
        await prisma.trainerAthlete.deleteMany({
          where: {
            OR: [
              { trainerId: { in: userIds } },
              { athleteId: { in: userIds } },
              { initiatedById: { in: userIds } },
              { endedById: { in: userIds } },
            ],
          },
        });

        await prisma.user.deleteMany({
          where: {
            id: { in: userIds },
          },
        });
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('should hide athlete identity details when athlete initiated and ended collaboration', async () => {
    let relationshipId: string | undefined;

    // createUser() registers users for afterAll cleanup.
    const newAthlete = await createUser(
      `athlete-history-privacy-${randomUUID()}@example.com`,
      'ATHLETE',
    );

    try {
      const athleteCookie = await login(newAthlete.email);

      // Athlete initiated the relationship.
      const relationship = await prisma.trainerAthlete.create({
        data: {
          trainerId: trainerOne.id,
          athleteId: newAthlete.id,
          initiatedById: newAthlete.id,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      relationshipId = relationship.id;

      // Athlete terminates the collaboration.
      const terminateResponse = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${relationship.id}/terminate`)
        .set('Cookie', athleteCookie)
        .send({
          reason: 'Collaboration ended by athlete',
        });

      expect(terminateResponse.status).toBe(200);

      expect(terminateResponse.body).toMatchObject({
        id: relationship.id,
        status: 'TERMINATED',
        initiatedById: newAthlete.id,
        endedById: newAthlete.id,
      });

      // Former trainer reads relationship details.
      const trainerDetails = await request(app!.getHttpServer())
        .get(`/trainer-athletes/${relationship.id}`)
        .set('Cookie', trainerOneCookie);

      expect(trainerDetails.status).toBe(200);

      expect(trainerDetails.body).toMatchObject({
        id: relationship.id,
        status: 'TERMINATED',
        athlete: {
          id: newAthlete.id,
          role: 'ATHLETE',
        },
        initiatedBy: {
          id: newAthlete.id,
          role: 'ATHLETE',
        },
        endedBy: {
          id: newAthlete.id,
          role: 'ATHLETE',
        },
      });

      // None of the nested user objects may expose email.
      expect(trainerDetails.body.athlete).not.toHaveProperty('email');
      expect(trainerDetails.body.initiatedBy).not.toHaveProperty('email');
      expect(trainerDetails.body.endedBy).not.toHaveProperty('email');

      expect(JSON.stringify(trainerDetails.body)).not.toContain(
        newAthlete.email,
      );

      // Verify historical list response as well.
      const trainerList = await request(app!.getHttpServer())
        .get('/trainer-athletes')
        .set('Cookie', trainerOneCookie)
        .query({
          status: 'TERMINATED',
          page: 1,
          limit: 100,
        });

      expect(trainerList.status).toBe(200);

      const historicalItem = trainerList.body.data.find(
        (item: { id: string }) => item.id === relationship.id,
      );

      expect(historicalItem).toBeDefined();

      expect(historicalItem).toMatchObject({
        id: relationship.id,
        status: 'TERMINATED',
      });

      expect(JSON.stringify(historicalItem)).not.toContain(newAthlete.email);

      // Athlete retains full access to their own relationship history.
      const athleteDetails = await request(app!.getHttpServer())
        .get(`/trainer-athletes/${relationship.id}`)
        .set('Cookie', athleteCookie);

      expect(athleteDetails.status).toBe(200);

      expect(athleteDetails.body).toMatchObject({
        athlete: {
          id: newAthlete.id,
          email: newAthlete.email,
        },
        initiatedBy: {
          id: newAthlete.id,
          email: newAthlete.email,
        },
        endedBy: {
          id: newAthlete.id,
          email: newAthlete.email,
        },
      });
    } finally {
      if (relationshipId) {
        await prisma.trainerAthlete.deleteMany({
          where: { id: relationshipId },
        });
      }
    }
  }, 20_000);

  describe('Authentication and validation', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await request(app!.getHttpServer()).get(
        '/trainer-athletes',
      );

      expect(response.status).toBe(401);
    });

    it('should reject an invalid relationship UUID', async () => {
      const response = await request(app!.getHttpServer())
        .get('/trainer-athletes/not-a-valid-uuid')
        .set('Cookie', trainerOneCookie);

      expect(response.status).toBe(400);
    });

    it('should reject unexpected fields when creating a relationship', async () => {
      const response = await request(app!.getHttpServer())
        .post('/trainer-athletes')
        .set('Cookie', trainerOneCookie)
        .send({
          userId: athleteOne.id,
          trainerId: trainerTwo.id,
          status: 'ACTIVE',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /trainer-athletes', () => {
    it('should allow a trainer to initiate a relationship', async () => {
      const response = await request(app!.getHttpServer())
        .post('/trainer-athletes')
        .set('Cookie', trainerOneCookie)
        .send({
          userId: athleteOne.id,
        });

      expect(response.status).toBe(201);

      expect(response.body).toMatchObject({
        trainerId: trainerOne.id,
        athleteId: athleteOne.id,
        initiatedById: trainerOne.id,
        status: 'PENDING',
      });

      trainerInitiatedRelationshipId = response.body.id;
    });

    it('should allow the athlete to initiate a relationship', async () => {
      const response = await request(app!.getHttpServer())
        .post('/trainer-athletes')
        .set('Cookie', athleteTwoCookie)
        .send({
          userId: trainerOne.id,
        });

      expect(response.status).toBe(201);

      expect(response.body).toMatchObject({
        trainerId: trainerOne.id,
        athleteId: athleteTwo.id,
        initiatedById: athleteTwo.id,
        status: 'PENDING',
      });

      athleteInitiatedRelationshipId = response.body.id;
    });

    it('should reject a duplicate open relationship', async () => {
      const response = await request(app!.getHttpServer())
        .post('/trainer-athletes')
        .set('Cookie', trainerOneCookie)
        .send({
          userId: athleteOne.id,
        });

      expect(response.status).toBe(409);
    });
  });

  describe('GET /trainer-athletes', () => {
    it('should return relationships for the trainer', async () => {
      const response = await request(app!.getHttpServer())
        .get('/trainer-athletes')
        .set('Cookie', trainerOneCookie)
        .query({
          status: 'PENDING',
          page: 1,
          limit: 10,
        });

      expect(response.status).toBe(200);

      const ids = response.body.data.map(
        (relationship: { id: string }) => relationship.id,
      );

      expect(ids).toContain(trainerInitiatedRelationshipId);
      expect(ids).toContain(athleteInitiatedRelationshipId);
    });

    it('should return relationships for the athlete', async () => {
      const response = await request(app!.getHttpServer())
        .get('/trainer-athletes')
        .set('Cookie', athleteTwoCookie);

      expect(response.status).toBe(200);

      const ids = response.body.data.map(
        (relationship: { id: string }) => relationship.id,
      );

      expect(ids).toContain(athleteInitiatedRelationshipId);
    });

    it('should not return another user relationships', async () => {
      const response = await request(app!.getHttpServer())
        .get('/trainer-athletes')
        .set('Cookie', outsiderCookie);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });

  describe('GET /trainer-athletes/:id', () => {
    it('should return relationship details to a participant', async () => {
      const response = await request(app!.getHttpServer())
        .get(`/trainer-athletes/${trainerInitiatedRelationshipId}`)
        .set('Cookie', athleteOneCookie);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(trainerInitiatedRelationshipId);
    });

    it('should hide a relationship from an unrelated user', async () => {
      const response = await request(app!.getHttpServer())
        .get(`/trainer-athletes/${trainerInitiatedRelationshipId}`)
        .set('Cookie', outsiderCookie);

      expect(response.status).toBe(404);
    });
  });

  describe('Accept and decline', () => {
    it('should reject acceptance by the request initiator', async () => {
      const response = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${trainerInitiatedRelationshipId}/accept`)
        .set('Cookie', trainerOneCookie);

      expect(response.status).toBe(403);
    });

    it('should allow the recipient to accept the request', async () => {
      const response = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${trainerInitiatedRelationshipId}/accept`)
        .set('Cookie', athleteOneCookie);

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        id: trainerInitiatedRelationshipId,
        status: 'ACTIVE',
      });

      expect(response.body.respondedAt).toBeTruthy();
    });

    it('should reject a duplicate active relationship', async () => {
      const response = await request(app!.getHttpServer())
        .post('/trainer-athletes')
        .set('Cookie', athleteOneCookie)
        .send({
          userId: trainerOne.id,
        });

      expect(response.status).toBe(409);
    });

    it('should reject declining a request by its initiator', async () => {
      const response = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${athleteInitiatedRelationshipId}/decline`)
        .set('Cookie', athleteTwoCookie);

      expect(response.status).toBe(403);
    });

    it('should allow the recipient to decline a pending request', async () => {
      const createResponse = await request(app!.getHttpServer())
        .post('/trainer-athletes')
        .set('Cookie', athleteTwoCookie)
        .send({
          userId: trainerTwo.id,
        });

      expect(createResponse.status).toBe(201);

      declinedRelationshipId = createResponse.body.id;

      const response = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${declinedRelationshipId}/decline`)
        .set('Cookie', trainerTwoCookie);

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        id: declinedRelationshipId,
        status: 'DECLINED',
      });

      expect(response.body.respondedAt).toBeTruthy();
    });

    it('should allow a new request after a declined relationship', async () => {
      const response = await request(app!.getHttpServer())
        .post('/trainer-athletes')
        .set('Cookie', athleteTwoCookie)
        .send({
          userId: trainerTwo.id,
        });

      const cancelResponse = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${response.body.id}/cancel`)
        .set('Cookie', athleteTwoCookie);

      expect(cancelResponse.status).toBe(200);
      expect(cancelResponse.body.status).toBe('CANCELLED');
      expect(response.status).toBe(201);
      expect(response.body.status).toBe('PENDING');
      expect(response.body.id).not.toBe(declinedRelationshipId);
    });
  });

  describe('Cancel pending requests', () => {
    it('should reject cancellation by the request recipient', async () => {
      const response = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${athleteInitiatedRelationshipId}/cancel`)
        .set('Cookie', trainerOneCookie)
        .send({
          reason: 'Should not be allowed',
        });

      expect(response.status).toBe(403);
    });

    it('should allow the initiator to cancel a pending request', async () => {
      const response = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${athleteInitiatedRelationshipId}/cancel`)
        .set('Cookie', athleteTwoCookie)
        .send({
          reason: 'Changed my mind',
        });

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        id: athleteInitiatedRelationshipId,
        status: 'CANCELLED',
        endedById: athleteTwo.id,
        endReason: 'Changed my mind',
      });

      expect(response.body.endedAt).toBeTruthy();
    });

    it('should allow a new request after cancellation', async () => {
      const response = await request(app!.getHttpServer())
        .post('/trainer-athletes')
        .set('Cookie', trainerOneCookie)
        .send({
          userId: athleteTwo.id,
        });

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('PENDING');

      const cancelResponse = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${response.body.id}/cancel`)
        .set('Cookie', trainerOneCookie);

      expect(cancelResponse.status).toBe(200);
      expect(cancelResponse.body.status).toBe('CANCELLED');
    });
  });

  describe('Terminate active relationships', () => {
    it('should allow the trainer to terminate an active relationship', async () => {
      const response = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${trainerInitiatedRelationshipId}/terminate`)
        .set('Cookie', trainerOneCookie)
        .send({
          reason: 'Cooperation ended by trainer',
        });

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        id: trainerInitiatedRelationshipId,
        status: 'TERMINATED',
        endedById: trainerOne.id,
        endReason: 'Cooperation ended by trainer',
      });

      expect(response.body.endedAt).toBeTruthy();
    });

    it('should allow a new request after termination', async () => {
      const createResponse = await request(app!.getHttpServer())
        .post('/trainer-athletes')
        .set('Cookie', athleteOneCookie)
        .send({
          userId: trainerOne.id,
        });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.status).toBe('PENDING');

      const acceptResponse = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${createResponse.body.id}/accept`)
        .set('Cookie', trainerOneCookie);

      expect(acceptResponse.status).toBe(200);
      expect(acceptResponse.body.status).toBe('ACTIVE');

      const terminateResponse = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${createResponse.body.id}/terminate`)
        .set('Cookie', athleteOneCookie)
        .send({
          reason: 'Cooperation ended by athlete',
        });

      expect(terminateResponse.status).toBe(200);

      expect(terminateResponse.body).toMatchObject({
        status: 'TERMINATED',
        endedById: athleteOne.id,
        endReason: 'Cooperation ended by athlete',
      });
    });

    it('should reject termination of a pending relationship', async () => {
      const createResponse = await request(app!.getHttpServer())
        .post('/trainer-athletes')
        .set('Cookie', trainerTwoCookie)
        .send({
          userId: athleteTwo.id,
        });

      expect(createResponse.status).toBe(201);

      const response = await request(app!.getHttpServer())
        .post(`/trainer-athletes/${createResponse.body.id}/terminate`)
        .set('Cookie', trainerTwoCookie);

      expect(response.status).toBe(409);
    });
  });
});
