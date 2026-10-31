import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaTokenStore } from '../stores/index.js';

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(private readonly tokenStore: PrismaTokenStore) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    timeZone: 'Europe/Kyiv',
  })
  async cleanupExpiredTokens(): Promise<void> {
    try {
      const now = new Date();

      await Promise.all([
        this.tokenStore.deleteExpiredRefreshTokens(now),
        this.tokenStore.deleteExpiredEmailTokens(now),
      ]);

      this.logger.log('Expired tokens cleanup completed');
    } catch (error) {
      this.logger.error(
        'Failed to cleanup expired tokens',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
