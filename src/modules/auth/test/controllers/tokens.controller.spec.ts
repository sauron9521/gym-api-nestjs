import type { TokenService } from '@nestjs/authentication';
import { UnauthorizedException } from '@nestjs/common';

import { TokensController } from '../../controllers/tokens.controller.js';
import type { CredentialsService } from '../../services/credentials.service.js';

describe('TokensController', () => {
  const credentials = { verify: vi.fn() };
  const tokens = {
    issue: vi.fn(),
    refresh: vi.fn(),
    revoke: vi.fn(),
  };
  let controller: TokensController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new TokensController(
      credentials as unknown as CredentialsService,
      tokens as unknown as TokenService,
    );
  });

  it('issues credentials-derived tokens with password AMR claims', async () => {
    const body = { email: 'member@example.test', password: 'CorrectPassword123!' };
    const result = { accessToken: 'access-token', refreshToken: 'refresh-token' };
    credentials.verify.mockResolvedValue({ id: 'user-1' });
    tokens.issue.mockResolvedValue(result);

    await expect(controller.issue(body)).resolves.toBe(result);
    expect(credentials.verify).toHaveBeenCalledExactlyOnceWith(
      body.email,
      body.password,
    );
    expect(tokens.issue).toHaveBeenCalledExactlyOnceWith('user-1', {
      method: 'password',
      claims: { amr: ['pwd'] },
    });
  });

  it('rejects invalid credentials before issuing any token', async () => {
    credentials.verify.mockResolvedValue(null);

    await expect(controller.issue({
      email: 'member@example.test',
      password: 'IncorrectPassword123!',
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('delegates refresh using only the provided refresh token value', async () => {
    const result = { accessToken: 'new-access', refreshToken: 'new-refresh' };
    tokens.refresh.mockResolvedValue(result);

    await expect(controller.refresh({ refreshToken: 'current-refresh' }))
      .resolves.toBe(result);
    expect(tokens.refresh).toHaveBeenCalledExactlyOnceWith('current-refresh');
  });

  it('revokes the provided token without returning a body', async () => {
    tokens.revoke.mockResolvedValue(undefined);

    await expect(controller.revoke({ refreshToken: 'current-refresh' }))
      .resolves.toBeUndefined();
    expect(tokens.revoke).toHaveBeenCalledExactlyOnceWith('current-refresh');
  });

  it('does not mask refresh errors or issue a new token', async () => {
    const failure = new UnauthorizedException();
    tokens.refresh.mockRejectedValue(failure);

    await expect(controller.refresh({ refreshToken: 'expired-refresh' }))
      .rejects.toBe(failure);
    expect(tokens.issue).not.toHaveBeenCalled();
  });
});
