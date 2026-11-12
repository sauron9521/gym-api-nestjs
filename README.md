# Gym API — NestJS 12

Backend for a workout/coach platform with authentication, exercise libraries,
workouts and sets, trainer–athlete relationships, versioned training programs,
user profiles/avatars and body measurements.

**Stack:** NestJS 12 (ESM), TypeScript, Prisma 7, PostgreSQL 17,
Vitest, Zod 4, Docker and GitHub Actions. An optional Redis backend shares
rate limits between API replicas.

## Local development

Requirements: **Node.js 22**, npm, Docker Compose and PostgreSQL 17.

```bash
cp .env.example .env
# Configure POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, DATABASE_URL,
# APP_URL, JWT_SECRET and JWT_ISSUER in the untracked .env.
docker compose up -d postgres redis
npm ci
npm run config:validate
npm run db:generate
npm run db:migrate:dev
npm run start:dev
```

For local-only rate limiting, leave `REDIS_URL` blank. If you enable
Redis, set `REDIS_URL=redis://127.0.0.1:6379` in the untracked `.env`.
The app does not send real email in local/test mode without SMTP; never
use development mail logging in production.

The test database must be separate from your development database:
configure `TEST_DATABASE_URL` with a database name containing `test`.
Never run `db:reset` against production.

## Checks and generated contracts

```bash
npm run lint
npm run build
npm test
npm run test:e2e
npm run test:cov
npm run docs:openapi
npm run docs:types
```

Integration tests require the dedicated PostgreSQL test database and its
migrations. Tests of distributed Redis throttling run when
`TEST_REDIS_URL` is available. GitHub Actions provisions both services.
Run `npm run db:migrate:deploy` for applying existing migrations in a
managed environment; use a separate migration container in production.

- OpenAPI: [generation and typed clients](docs/openapi.md)
- Auth: [security policy](docs/auth-security-policy.md)
- Exercises: [access and sharing](docs/exercise-sharing-active-relationship.md)
- Workouts: [list responses](docs/workout-list-summary.md)
- Body measurements: [statistics consistency](docs/body-measurement-statistics-consistency.md)
- Workout analytics: [athlete-only UTC statistics and actual strength volume](docs/workout-analytics.md)
- Import conventions: [native ESM aliases](docs/native-esm-imports.md)

## Production operations

The provided deployment is **single-host**, with an externally managed
PostgreSQL server, a persistent named avatar volume, non-root/read-only API
container, a separate migration image and optional managed Redis.

- [Docker production deployment](docs/docker-production.md)
- [Production environment and secrets](docs/production-configuration.md)
- [Backup, isolated restore, monitoring and incident runbook](docs/production-operations-runbook.md)
- [Opt-in daily backup scheduling and safe restore rehearsals](docs/backup-automation-restore-drill.md)
- [Backup alerting and notification receipt drill](docs/backup-alert-delivery.md)
- [Health, request IDs and safe logs](docs/observability-health.md)
- [Rate limiting, Redis and proxy trust](docs/rate-limiting-and-proxies.md)
- [Blocking CI gate and branch protection](docs/ci-required-gates.md)
- [Signed, immutable release candidate artifacts (manual)](docs/release-artifacts.md)
- [GHCR publication of verified release candidates (manual)](docs/ghcr-promotion.md)
- [GHCR image SBOMs, vulnerability gates, OCI provenance and retention](docs/ghcr-supply-chain.md)
- [Manual immutable-digest deployment and runtime-only rollback](docs/production-digest-deployment.md)
- [Manual disposable staging rehearsal of verified GHCR images](docs/staging-ghcr-rehearsal.md)
- [Manual two-signed-release staging upgrade and runtime-only rollback rehearsal](docs/staging-two-release-upgrade.md)
- [Production readiness evidence and human approval gate (NO-GO by default)](docs/production-readiness-approval.md)

`GET /health/live` only checks API process health.
`GET /health/ready` checks PostgreSQL and, if `REDIS_URL` is configured,
the shared Redis throttling backend. Public probes contain no internal
connection details.

**Production checklist:** provision secrets securely; take verified,
encrypted off-host backups and perform a restore rehearsal; configure
external TLS/proxy forwarding, centralized logging, health alerts and
controlled deployment/rollback. The repository does not automatically
configure production backup schedules, alert providers, database restore,
or image registry/signing.

## Contribution workflow

Use feature branches and pull requests against `main`. The GitHub Actions
`CI / required gates` check summarizes the dependency audit, lint/build/
unit/E2E/coverage checks and Docker production smoke. Require it in branch
protection; keep merging and production deployment as separate reviewed
operations.
