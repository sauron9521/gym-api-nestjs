# Cross-module security headers, error consistency, and safe avatar cleanup logs — PR #60

## Findings

The global `ApiExceptionFilter` already maps Prisma and unexpected server errors to public-safe error codes and messages, retaining intentional domain-specific 4xx messages, and logs only safe categories with server-generated request IDs. PR #58–59 established auth-only no-store headers before authentication guards. Other sensitive API resources could still be cached, including successful personal profiles, workouts and mixed-visibility exercises. `AvatarService.removePrevious` also wrote arbitrary filesystem error text and the unguessable avatar key into production warning logs.

## Changes

1. Apply `PrivateApiNoStoreMiddleware` before guards and controllers to exact root segments of: `/users`, `/workouts`, `/trainer-athletes`, `/training-programs`, `/body-measurements`, `/exercises`, and `/avatars`. Match root segment boundaries and ignore query strings. `/exercises` requires this even for guests because signed-in responses can include private exercises at the same URL.
2. Set `Cache-Control: no-store` on every JSON error produced by the global `ApiExceptionFilter`, including 4xx validation/guard/domain/Prisma and sanitized 5xx responses, even on an unlisted route. Keep the existing HTTP status, JSON body shape, request ID, and safe error mapping.
3. Log only `AVATAR_CLEANUP_FAILED` when avatar file cleanup fails. This remains best-effort after database commit, and preserves the original exception when rolling back an upload; never log the key, filesystem path or arbitrary error payload.

## Deliberate exclusions

- `/health/live` successful responses remain untouched to avoid changing health-check behavior.
- `/auth` retains its dedicated early no-store middleware and controller interceptor from earlier PRs.
- Public `/avatars/:key` already sets `no-store` on success; early middleware also protects errors.
- No security model change, no new headers beyond `Cache-Control`, no public response fields/status changes, migrations, Prisma schema or dependencies.

## Tests and CI

- Middleware unit tests pin allowed roots and collision resistance such as `/users-other`.
- Real `AppModule`/PostgreSQL HTTP tests cover private guard failures, public mixed exercises and unchanged health response. Existing authenticated `GET /users/me` integration path verifies the success header.
- HTTP exception contract tests assert no-store for all mapped error classes (4xx, Prisma, internal HTTP, 503).
- Avatar service tests prove best-effort cleanup, original rollback error preservation and zero sensitive log data.
- Require lint, TS/ESM build, Prisma validate/generate, unit, integration/E2E, OpenAPI, coverage, Docker smoke and dependency audit before merge.
