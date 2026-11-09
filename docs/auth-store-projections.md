# Authentication store projections and mappers — PR #56

## Boundary conventions

`AuthModule` deliberately keeps framework adapters under `stores/` and `providers/`. Stores are not generic CRUD repositories: `PrismaSessionStore` registers the session storage contract and `PrismaTokenStore` registers refresh/email token contracts with `@nestjs/authentication`. Providers separately register ordered session/JWT user validation. Avoid moving or merging those responsibilities just to match other modules' `repositories/` naming.

- `selects/`: minimal, Prisma-checked projections for session/refresh read records, revocation probes, email pending quota.
- `types/`: `Prisma.*GetPayload` types derived from their precise projections and the one typed SQL `DELETE ... RETURNING` row shape.
- `mappers/`: explicitly transform selected database rows to `SessionRecord`, `RefreshTokenRecord`, `EmailTokenRecord` and omit null optional fields. Never serialize persistence metadata as auth contract fields.
- `stores/`: remain the source adapters, own SQL queries, transactions, concurrency invariants and source registration.
- `providers/`: retain distinct registry order, JWT and cookie strategy behavior.
- `services/`, `controllers/`, `mailers/`: unchanged.

## Security invariants

- Session reads and refresh token lookup require `user.deletedAt = null`. Session `touch` remains monotonic, and session deletion remains conditional.
- Refresh-token usage is set once via `updateMany({ usedAt: null })`; family revocation updates both the family and its tokens in a transaction. Do not reimplement these as read-then-write.
- Email token consumption remains one atomic `DELETE ... RETURNING` with exact purpose matching, so parallel consumers cannot reuse a token.
- Email pending-token cleanup keeps the advisory transaction lock, deterministic `expiresAt`/`id` order and bounded quota. `maxPending` can still be overridden by contract tests.
- `jwt-auth.provider.ts` and `session-auth.provider.ts` remain unchanged, including registration order.
- No HTTP routes, auth package APIs, DB schema or migration, token lifetimes, or dependencies change.

## CI checks

Require lint, Prisma validate/generate, build, ESM smoke, unit tests for select shapes/mappers and session store, PostgreSQL integration and the concurrency-sensitive `@nestjs/authentication/testing` store contracts, E2E auth/refresh flows, security audit and Docker production smoke before merge.
