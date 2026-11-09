import type { ConfigService } from '@nestjs/config';
import type { AppEnv } from './env.schema.js';

/**
 * Strictly typed, Zod-validated application configuration.
 *
 * This is only a TypeScript alias, not a Nest injection token.
 * Inject the existing ConfigService class (explicitly with @Inject
 * when a constructor parameter is typed as this alias).
 */
export type AppConfigService = ConfigService<AppEnv, true>;
