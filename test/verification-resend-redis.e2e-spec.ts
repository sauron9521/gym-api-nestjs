import { randomUUID } from 'node:crypto';

import {
  Controller,
  HttpCode,
  Post,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { DistributedThrottlerStorage } from '../src/common/rate-limit/distributed-throttler.storage.js';
import { VerificationResendRateLimitGuard } from '../src/modules/auth/guards/verification-resend-rate-limit.guard.js';

const redisUrl = process.env.TEST_REDIS_URL;
const redisDescribe = redisUrl ? describe : describe.skip;

@Controller('verification-resend-redis-test')
class VerificationResendTestController {
  @UseGuards(VerificationResendRateLimitGuard)
  @Post('resend')
  @HttpCode(202)
  resend() {
    return { accepted: true };
  }
}

redisDescribe('Verification resend throttle (two Redis-backed HTTP apps)', () => {
  const apps: INestApplication[] = [];
  const storages: DistributedThrottlerStorage[] = [];

  async function makeApp() {
    const storage = new DistributedThrottlerStorage({
      get: (key: string) => key === 'REDIS_URL' ? redisUrl : undefined,
    } as never);
    storages.push(storage);

    const moduleRef = await Test.createTestingModule({
      controllers: [VerificationResendTestController],
      providers: [
        { provide: DistributedThrottlerStorage, useValue: storage },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'test-shared-resend-key-with-32-or-more-bytes' },
        },
        VerificationResendRateLimitGuard,
      ],
    }).compile();
    const app = moduleRef.createNestApplication();

    // Test-only authenticated identity fixture; no public endpoint accepts
    // this header and the production guard reads request.user exclusively.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const id = req.header('X-Test-User-Id');
      if (id) {
        Object.assign(req, { user: { id, emailVerified: false } });
      }
      next();
    });
    await app.init();
    apps.push(app);
    return app;
  }

  afterAll(async () => {
    for (const app of apps) await app.close();
    for (const storage of storages) await storage.onApplicationShutdown();
  });

  it('atomically shares one per-user quota over two HTTP apps and ten simultaneous requests', async () => {
    const [first, second] = await Promise.all([makeApp(), makeApp()]);
    const userId = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        request((index % 2 === 0 ? first : second).getHttpServer())
          .post('/verification-resend-redis-test/resend')
          .set('X-Test-User-Id', userId)
          .set('X-Forwarded-For', `203.0.113.${index + 1}`),
      ),
    );

    expect(responses.filter((response) => response.status === 202)).toHaveLength(5);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(5);

    // A different user is not penalized by the previous user's quota.
    await request(second.getHttpServer())
      .post('/verification-resend-redis-test/resend')
      .set('X-Test-User-Id', randomUUID())
      .expect(202);
  });
});
