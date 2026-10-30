import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaTokenStore } from '../prisma-token.store.js';

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(private readonly tokenStore: PrismaTokenStore) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredTokens(): Promise<void> {
    this.logger.log('Starting expired refresh tokens cleanup');

    try {
      await this.tokenStore.deleteExpiredRefreshTokens();

      this.logger.log('Expired refresh tokens cleanup completed');
    } catch (error) {
      this.logger.error('Failed to cleanup expired refresh tokens', error);
    }
  }
}
