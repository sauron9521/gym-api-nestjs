import type { PasswordResetService } from '@nestjs/authentication';
import { BadRequestException } from '@nestjs/common';

import { PasswordResetController } from '../../controllers/password-reset.controller.js';

describe('PasswordResetController', () => {
  const service = {
    request: vi.fn(),
    reset: vi.fn(),
  };
  let controller: PasswordResetController;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new PasswordResetController(
      service as unknown as PasswordResetService,
    );
  });

  it('accepts a recovery request without disclosing whether the email exists', async () => {
    const body = { email: 'member@example.test' };
    service.request.mockResolvedValue(undefined);

    await expect(controller.forgot(body)).resolves.toBeUndefined();
    expect(service.request).toHaveBeenCalledExactlyOnceWith(body.email);
    expect(service.reset).not.toHaveBeenCalled();
  });

  it('returns the existing MFA requirement after a successful reset and sign-in', async () => {
    const body = { token: 'reset-token', password: 'UpdatedPassword123!' };
    service.reset.mockResolvedValue({ signedIn: { session: { mfa: 'pending' } } });

    await expect(controller.reset(body)).resolves.toEqual({ mfaRequired: true });
    expect(service.reset).toHaveBeenCalledExactlyOnceWith(
      body.token,
      body.password,
      { signIn: true },
    );
  });

  it('returns mfaRequired false when there is no pending MFA', async () => {
    service.reset.mockResolvedValue({ signedIn: { session: { mfa: 'verified' } } });

    await expect(controller.reset({
      token: 'reset-token',
      password: 'UpdatedPassword123!',
    })).resolves.toEqual({ mfaRequired: false });
  });

  it('rejects an invalid or expired link without returning a token', async () => {
    const body = { token: 'invalid-token', password: 'UpdatedPassword123!' };
    service.reset.mockResolvedValue(null);

    await expect(controller.reset(body)).rejects.toBeInstanceOf(BadRequestException);
    expect(service.reset).toHaveBeenCalledExactlyOnceWith(
      body.token,
      body.password,
      { signIn: true },
    );
  });

  it('preserves service failures and does not claim a successful reset', async () => {
    const failure = new Error('Reset storage unavailable');
    service.reset.mockRejectedValue(failure);

    await expect(controller.reset({
      token: 'reset-token',
      password: 'UpdatedPassword123!',
    })).rejects.toBe(failure);
  });
});
