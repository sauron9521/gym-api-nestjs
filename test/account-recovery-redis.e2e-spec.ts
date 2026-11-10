import { randomUUID } from 'node:crypto';

import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { DistributedThrottlerStorage } from '../src/common/rate-limit/distributed-throttler.storage.js';
import { AccountRecoveryRateLimitGuard } from '../src/modules/auth/guards/account-recovery-rate-limit.guard.js';
import { AuthAccountThrottleService } from '../src/modules/auth/services/auth-account-throttle.service.js';

const redisUrl = process.env.TEST_REDIS_URL;
const redisDescribe = redisUrl ? describe : describe.skip;

@Controller('account-recovery-rate-test')
class RecoveryTestController {
  @UseGuards(AccountRecoveryRateLimitGuard)
  @Post('forgot')
  @HttpCode(202)
  forgot(@Body() body: { email: string }) {
    return { accepted: Boolean(body.email) };
  }
}

redisDescribe('Account recovery throttle (two Redis-backed HTTP apps)', () => {
  const apps: INestApplication[] = [];
  const storages: DistributedThrottlerStorage[] = [];

  async function makeApp() {
    const storage = new DistributedThrottlerStorage({
      get: (name: string) => name === 'REDIS_URL' ? redisUrl : undefined,
    } as never);
    storages.push(storage);
    const moduleRef = await Test.createTestingModule({
      controllers: [RecoveryTestController],
      providers: [
        { provide: DistributedThrottlerStorage, useValue: storage },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => 'shared-recovery-HMAC-key-for-Redis-integration',
          },
        },
        AuthAccountThrottleService,
        AccountRecoveryRateLimitGuard,
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    apps.push(app);
    return app;
  }

  afterAll(async () => {
    for (const app of apps) {
      await app.close();
    }
    for (const storage of storages) {
      await storage.onApplicationShutdown();
    }
  });

  it('shares one atomic email counter across instances and concurrent IPs', async () => {
    const [first, second] = await Promise.all([makeApp(), makeApp()]);
    const email = `redis-recovery-${randomUUID()}@example.test`;

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        request((index % 2 === 0 ? first : second).getHttpServer())
          .post('/account-recovery-rate-test/forgot')
          .set('X-Forwarded-For', `203.0.113.${index + 1}`)
          .send({ email: index % 2 === 0 ? email.toUpperCase() : email }),
      ),
    );

    expect(responses.filter((response) => response.status === 202)).toHaveLength(5);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(5);
    expect(
      await request(second.getHttpServer())
        .post('/account-recovery-rate-test/forgot')
        .send({ email: `another-${email}` })
        .then((response) => response.status),
    ).toBe(202);
  });
});
