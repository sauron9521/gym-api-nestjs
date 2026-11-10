import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenCleanupService } from '../../services/index.js';
import { PrismaSessionStore, PrismaTokenStore } from '../../stores/index.js';

describe('TokenCleanupService', () => {
  let service: TokenCleanupService;
  let tokenStore: {
    deleteExpiredRefreshTokens: ReturnType<typeof vi.fn>;
    deleteExpiredEmailTokens: ReturnType<typeof vi.fn>;
  };

  let sessionStore: {
    deleteExpiredSessions: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tokenStore = {
      deleteExpiredRefreshTokens: vi.fn().mockResolvedValue(undefined),
      deleteExpiredEmailTokens: vi.fn().mockResolvedValue(undefined),
    };

    sessionStore = {
      deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
    };

    service = new TokenCleanupService(
      tokenStore as unknown as PrismaTokenStore,
      sessionStore as unknown as PrismaSessionStore,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cleanupExpiredTokens', () => {
    it('cleans expired refresh and email tokens', async () => {
      await service.cleanupExpiredTokens();

      expect(tokenStore.deleteExpiredRefreshTokens).toHaveBeenCalledOnce();
      expect(tokenStore.deleteExpiredEmailTokens).toHaveBeenCalledOnce();
      expect(sessionStore.deleteExpiredSessions).toHaveBeenCalledOnce();

      const refreshDate =
        tokenStore.deleteExpiredRefreshTokens.mock.calls[0][0];

      const emailDate = tokenStore.deleteExpiredEmailTokens.mock.calls[0][0];

      expect(refreshDate).toBeInstanceOf(Date);
      expect(emailDate).toBe(refreshDate);
      expect(sessionStore.deleteExpiredSessions).toHaveBeenCalledWith(refreshDate);
    });

    it('logs only a safe event name, never exception text or stack data', async () => {
      const secret = 'refresh-token-secret-do-not-log';
      const error = new Error(`Prisma query failed WHERE token = ${secret}`);
      error.stack = `SQL/stack trace with ${secret}`;
      const loggerErrorSpy = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const loggerSuccessSpy = vi
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      tokenStore.deleteExpiredRefreshTokens.mockRejectedValueOnce(error);

      await expect(service.cleanupExpiredTokens()).resolves.toBeUndefined();

      expect(loggerErrorSpy).toHaveBeenCalledExactlyOnceWith(
        'AUTH_TOKEN_CLEANUP_FAILED',
      );
      expect(JSON.stringify(loggerErrorSpy.mock.calls)).not.toContain(secret);
      expect(loggerSuccessSpy).not.toHaveBeenCalled();
    });

    it('never logs sensitive values when the thrown failure is not an Error', async () => {
      const loggerErrorSpy = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      tokenStore.deleteExpiredEmailTokens.mockRejectedValueOnce(
        'password-reset-token-secret',
      );

      await expect(service.cleanupExpiredTokens()).resolves.toBeUndefined();

      expect(loggerErrorSpy).toHaveBeenCalledExactlyOnceWith(
        'AUTH_TOKEN_CLEANUP_FAILED',
      );
      expect(JSON.stringify(loggerErrorSpy.mock.calls)).not.toContain(
        'password-reset-token-secret',
      );
    });

    it('reports a safe failure when session cleanup fails', async () => {
      const loggerErrorSpy = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const loggerSuccessSpy = vi
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      sessionStore.deleteExpiredSessions.mockRejectedValueOnce(
        new Error('sensitive database connection information'),
      );

      await expect(service.cleanupExpiredTokens()).resolves.toBeUndefined();
      expect(loggerErrorSpy).toHaveBeenCalledExactlyOnceWith(
        'AUTH_TOKEN_CLEANUP_FAILED',
      );
      expect(loggerSuccessSpy).not.toHaveBeenCalled();
    });

    it('logs successful cleanup', async () => {
      const loggerLogSpy = vi
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      await service.cleanupExpiredTokens();

      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Expired auth tokens and sessions cleanup completed',
      );
    });
  });
});
