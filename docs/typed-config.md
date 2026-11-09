# Typed configuration convention (PR #49)

The application validates environment variables once at bootstrap using
Zod in `src/common/config/env.schema.ts`. The `ConfigModule` remains
global, so modules keep injecting the standard `ConfigService` token.

## Source layout

- `env.schema.ts`: validation, defaults and production security rules;
- `env.validation.ts`: fail-fast validator with redacted error diagnostics;
- `app-config.types.ts`: typed `AppConfigService` alias;
- `mail.config.ts`: mail transport configuration;
- `http.config.ts`: validated CORS origins;
- `logger.config.ts`: selected log levels;
- `test/`: focused unit tests for validation and derived settings.

## Injecting the typed config

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfigService } from '#src/common/config/app-config.types';

@Injectable()
export class ExampleService {
  constructor(
    @Inject(ConfigService) private readonly config: AppConfigService,
  ) {}

  getAppUrl() {
    return this.config.getOrThrow('APP_URL'); // string
  }
}
```

**Important:** `AppConfigService` is a TypeScript-only alias. It is NOT a
Nest injection token. If a constructor uses the alias, decorate its
parameter with `@Inject(ConfigService)`. In `forRootAsync` factories,
retain `inject: [ConfigService]`.

Keys and normalized types derive from `AppEnv`. No stringly typed
`config.get<string>('PORT')` or separate duplicate env schemas. New
settings belong in Zod with documented defaults and tests. No service
should read arbitrary `process.env` when validated config is available.

## Log level

`LOG_LEVEL` is optional, defaults to `log` and accepts `fatal`,
`error`, `warn`, `log`, `debug`, or `verbose`.
NestJS production JSON logging is preserved. The selected severity
includes all more-severe levels; `warn` suppresses normal HTTP completion
logs, while `debug` and `verbose` allow more detail.

`prisma7.config.ts` stays at the repository root and remains independent
from the Nest module graph, so Prisma CLI operations don't require
JWT/SMTP variables or the Nest application to start.

## Verify

```sh
npm run config:validate
npm run db:generate
npm run lint
npm run build
npm run imports:smoke
npm test
npm run test:e2e
npm run test:cov
```

The Docker smoke test additionally verifies production startup,
readiness and graceful shutdown. No database schema migration or public
HTTP contract changes are included in this PR.
