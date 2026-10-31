import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenCleanupService } from '../../services/index.js';
import { PrismaTokenStore } from '../../stores/index.js';

describe('TokenCleanupService', () => {
  let service: TokenCleanupService;
  let tokenStore: {
    deleteExpiredRefreshTokens: ReturnType<typeof vi.fn>;
    deleteExpiredEmailTokens: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tokenStore = {
      deleteExpiredRefreshTokens: vi.fn().mockResolvedValue(undefined),
      deleteExpiredEmailTokens: vi.fn().mockResolvedValue(undefined),
    };

    service = new TokenCleanupService(
      tokenStore as unknown as PrismaTokenStore,
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

      const refreshDate =
        tokenStore.deleteExpiredRefreshTokens.mock.calls[0][0];

      const emailDate = tokenStore.deleteExpiredEmailTokens.mock.calls[0][0];

      expect(refreshDate).toBeInstanceOf(Date);
      expect(emailDate).toBe(refreshDate);
    });

    it('logs an error when cleanup fails', async () => {
      const error = new Error('Database connection failed');
      const loggerErrorSpy = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      tokenStore.deleteExpiredRefreshTokens.mockRejectedValueOnce(error);

      await expect(service.cleanupExpiredTokens()).resolves.toBeUndefined();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Failed to cleanup expired tokens',
        error.stack,
      );
    });

    it('logs successful cleanup', async () => {
      const loggerLogSpy = vi
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      await service.cleanupExpiredTokens();

      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Expired tokens cleanup completed',
      );
    });
  });
});
