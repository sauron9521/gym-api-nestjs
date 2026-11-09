import { Module } from '@nestjs/common';

import { DistributedThrottlerStorage } from './distributed-throttler.storage.js';

@Module({
  providers: [DistributedThrottlerStorage],
  exports: [DistributedThrottlerStorage],
})
export class RateLimitStorageModule {}
