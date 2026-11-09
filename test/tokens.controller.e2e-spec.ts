import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { TokenService } from '@nestjs/authentication';
import request from 'supertest';
import { CredentialsService } from '../src/modules/auth/services/index.js';
import { TokensController } from '../src/modules/auth/controllers/index.js';

describe('TokensController (HTTP)', () => {
  let app: INestApplication;

  const credentialsService = { verify: vi.fn() };
  const tokenService = {
    issue: vi.fn(),
    refresh: vi.fn(),
    revoke: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TokensController],
      providers: [
        { provide: CredentialsService, useValue: credentialsService },
        { provide: TokenService, useValue: tokenService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('issues an access/refresh token pair after valid credentials', async () => {
    credentialsService.verify.mockResolvedValue({ id: 'user-1' });
    const pair = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 900,
    };
    tokenService.issue.mockResolvedValue(pair);

    const response = await request(app.getHttpServer())
      .post('/auth/token')
      .send({ email: 'test@example.com', password: 'StrongPassword123!' });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual(pair);
    expect(tokenService.issue).toHaveBeenCalledWith('user-1', {
      method: 'password',
      claims: { amr: ['pwd'] },
    });
  });

  it('rejects invalid credentials when issuing tokens', async () => {
    credentialsService.verify.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post('/auth/token')
      .send({ email: 'test@example.com', password: 'WrongPassword123!' });

    expect(response.status).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toContain('WrongPassword123!');
    expect(tokenService.issue).not.toHaveBeenCalled();
  });

  it('rotates a refresh token through TokenService', async () => {
    const pair = {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresIn: 900,
    };
    tokenService.refresh.mockResolvedValue(pair);

    const response = await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken: 'old-refresh-token' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(pair);
    expect(tokenService.refresh).toHaveBeenCalledWith('old-refresh-token');
  });

  it('rejects an empty refresh token before calling TokenService', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken: '' });

    expect(response.status).toBe(400);
    expect(tokenService.refresh).not.toHaveBeenCalled();
  });

  it('rejects invalid refresh credentials without echoing refresh tokens', async () => {
    const secret = 'refresh-token-that-must-not-appear-in-error';
    tokenService.refresh.mockRejectedValueOnce(
      new (await import('@nestjs/common')).UnauthorizedException(
        'Invalid refresh token',
      ),
    );

    const response = await request(app.getHttpServer())
      .post('/auth/token/refresh')
      .send({ refreshToken: secret });

    expect(response.status).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(tokenService.refresh).toHaveBeenCalledWith(secret);
  });

  it('revokes a refresh token and returns 204', async () => {
    tokenService.revoke.mockResolvedValue(undefined);

    const response = await request(app.getHttpServer())
      .post('/auth/token/revoke')
      .send({ refreshToken: 'refresh-token-to-revoke' });

    expect(response.status).toBe(204);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(tokenService.revoke).toHaveBeenCalledWith('refresh-token-to-revoke');
  });

  it('rejects a revoke request without a refresh token', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/token/revoke')
      .send({});

    expect(response.status).toBe(400);
    expect(tokenService.revoke).not.toHaveBeenCalled();
  });
});
