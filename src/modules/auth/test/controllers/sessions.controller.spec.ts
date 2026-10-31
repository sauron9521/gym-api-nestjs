import { describe, expect, it, vi } from 'vitest';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type {
  SessionRecord,
  SessionService,
  SignInService,
} from '@nestjs/authentication';
import { SessionsController } from '../../controllers/index.js';

describe('SessionsController', () => {
  const makeController = () => {
    const sessionService = {
      list: vi.fn(),
      revoke: vi.fn(),
    };
    const signInService = {
      signOut: vi.fn(),
      signOutEverywhere: vi.fn(),
    };
    const controller = new SessionsController(
      sessionService as unknown as SessionService,
      signInService as unknown as SignInService,
    );
    return { controller, sessionService, signInService };
  };

  it('lists only safe session fields and marks the current session', async () => {
    const { controller, sessionService } = makeController();
    const current = {
      id: 'session-current',
      userId: 'user-1',
      createdAt: new Date('2026-10-30T10:00:00.000Z'),
      expiresAt: new Date('2026-11-06T10:00:00.000Z'),
      lastActiveAt: new Date('2026-10-30T10:30:00.000Z'),
      metadata: { userAgent: 'Test browser', ip: '192.0.2.1' },
    } as SessionRecord;
    const other = {
      ...current,
      id: 'session-other',
      metadata: null,
    } as unknown as SessionRecord;
    sessionService.list.mockResolvedValue([current, other]);

    await expect(controller.list('user-1', current)).resolves.toEqual([
      {
        id: 'session-current',
        createdAt: current.createdAt,
        lastActiveAt: current.lastActiveAt,
        userAgent: 'Test browser',
        current: true,
      },
      {
        id: 'session-other',
        createdAt: other.createdAt,
        lastActiveAt: other.lastActiveAt,
        userAgent: null,
        current: false,
      },
    ]);
    expect(sessionService.list).toHaveBeenCalledWith('user-1');
  });

  it('revokes a session scoped to the authenticated user', async () => {
    const { controller, sessionService } = makeController();
    sessionService.revoke.mockResolvedValue(true);

    await expect(
      controller.revoke('user-1', 'session-2'),
    ).resolves.toBeUndefined();
    expect(sessionService.revoke).toHaveBeenCalledWith('session-2', {
      userId: 'user-1',
    });
  });

  it('returns not found for a session that does not belong to the user', async () => {
    const { controller, sessionService } = makeController();
    sessionService.revoke.mockResolvedValue(false);

    await expect(
      controller.revoke('user-1', 'someone-elses-session'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('signs out the current browser session', async () => {
    const { controller, signInService } = makeController();
    signInService.signOut.mockResolvedValue(true);

    await expect(controller.signOut()).resolves.toBeUndefined();
    expect(signInService.signOut).toHaveBeenCalledOnce();
  });

  it('rejects sign-out when there is no session cookie', async () => {
    const { controller, signInService } = makeController();
    signInService.signOut.mockResolvedValue(false);

    await expect(controller.signOut()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('signs the user out everywhere', async () => {
    const { controller, signInService } = makeController();

    await expect(
      controller.signOutEverywhere('user-1'),
    ).resolves.toBeUndefined();
    expect(signInService.signOutEverywhere).toHaveBeenCalledWith('user-1');
  });
});
