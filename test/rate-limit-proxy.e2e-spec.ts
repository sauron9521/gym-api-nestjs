import {
  Controller,
  Get,
  type INestApplication,
  Module,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getTrustedProxies } from '../src/common/config/proxy.config.js';

@Controller('rate-test')
class RateTestController {
  @Get()
  get() {
    return { success: true };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot({
    throttlers: [{ ttl: 60_000, limit: 2 }],
  })],
  controllers: [RateTestController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class RateTestModule {}

describe('trusted client IPs and HTTP rate limits', () => {
  let direct: INestApplication;
  let proxied: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RateTestModule],
    }).compile();
    direct = moduleRef.createNestApplication();
    await direct.init();

    const moduleRef2 = await Test.createTestingModule({
      imports: [RateTestModule],
    }).compile();
    proxied = moduleRef2.createNestApplication();
    proxied.getHttpAdapter().getInstance().set(
      'trust proxy',
      getTrustedProxies('loopback'),
    );
    await proxied.init();
  });

  afterAll(async () => {
    await direct?.close();
    await proxied?.close();
  });

  it('ignores forged X-Forwarded-For from untrusted clients', async () => {
    const server = direct.getHttpServer();
    await request(server).get('/rate-test')
      .set('X-Forwarded-For', '203.0.113.10').expect(200);
    await request(server).get('/rate-test')
      .set('X-Forwarded-For', '203.0.113.11').expect(200);
    await request(server).get('/rate-test')
      .set('X-Forwarded-For', '203.0.113.12').expect(429);
  });

  it('distinguishes real client addresses from a trusted loopback proxy', async () => {
    const server = proxied.getHttpServer();
    for (let i = 0; i < 2; i++) {
      await request(server).get('/rate-test')
        .set('X-Forwarded-For', '203.0.113.10').expect(200);
    }
    await request(server).get('/rate-test')
      .set('X-Forwarded-For', '203.0.113.10').expect(429);
    await request(server).get('/rate-test')
      .set('X-Forwarded-For', '203.0.113.20').expect(200);
  });

  it('does not trust an unconfigured second hop when only loopback is allowed', async () => {
    const server = proxied.getHttpServer();
    await request(server).get('/rate-test')
      .set('X-Forwarded-For', '198.51.100.1, 198.51.100.2').expect(200);
    await request(server).get('/rate-test')
      .set('X-Forwarded-For', '198.51.100.4, 198.51.100.2').expect(200);
    await request(server).get('/rate-test')
      .set('X-Forwarded-For', '198.51.100.5, 198.51.100.2').expect(429);
  });
});
