# Body Measurements architectural refactor (PR #51)

## Responsibility boundaries

- `repositories/` — Prisma queries, transactional ownership checks, the
  original row lock for partial updates, and the fixed allowlist used by
  the UTC-day statistics SQL.
- `services/` — access and not-found behavior, pagination, the
  chosen time window, assembling statistical comparison ranges.
- `selects/` — centrally typed public record and statistics
  projections using `satisfies Prisma.BodyMeasurementSelect`.
- `types/` — Prisma-derived payloads, input changes and HTTP
  response/metric types, independent of repository method signatures.
- `mappers/` — pure input conversion, explicit Decimal-to-number
  serialization, UTC timestamps, points and percentage calculations.
- `dto/` — Zod schemas and request validation.
- `test/` — focused mapper and existing module tests.

## Compatibility and invariants

No SQL schema migrations, dependency changes, routes or output fields.
The existing public endpoints under /body-measurements remain unchanged.
This refactor deliberately keeps the original statistics SQL, including
the trusted static metric-to-column mapping and the UTC-day DISTINCT ON
query. Never pass a client-controlled identifier to Prisma.raw.

The repository still scopes writes and reads by userId; updates retain
their SELECT ... FOR UPDATE lock and the invariant that at least one metric
must stay non-null. Partial updates preserve missing versus null values.
Public responses serialize Prisma Decimal as numbers, do not return userId,
and preserve timestamp/notes fields and pagination metadata.

## Checks

Full CI must pass lint, TypeScript build, OpenAPI, unit tests,
PostgreSQL integration/E2E, coverage thresholds, the production Docker
smoke test and security audit. The new mapper tests cover the legacy
number/date/null API behavior independently of repository internals.
