# Email-token concurrency and purpose isolation — PR #118

## Baseline and risk

PRs #116 and #117 verify sequential replay protection, token expiration,
cross-account email confirmation and password-reset security. The Prisma
email-token store already consumes tokens through a single PostgreSQL
`DELETE ... WHERE id AND purpose RETURNING` statement. Its unit and
storage-contract tests cover atomic persistence, but the HTTP routes had
no **parallel requests against the exact same link** or **cross-purpose**
regressions.

## New real HTTP + PostgreSQL cases

1. **Concurrent email verification** — two requests carrying exactly the
   same live verification link execute concurrently. Exactly one returns
   HTTP 200 and the other HTTP 400. The account becomes verified once,
   the token is gone and responses do not leak secrets.
2. **Concurrent password reset** — two requests with the same reset link
   execute concurrently. Exactly one succeeds (200) and one fails (400).
   The password is updated, the old password is rejected and the new one
   works; the token is consumed once.
3. **Purpose isolation in both directions** — a password-reset link
   cannot confirm email, and an email-verification link cannot reset a
   password. The failed attempts do not consume the two persisted
   tokens, and both remain valid for their proper operations.
4. **Soft-deleted account verification** — a verification link issued
   before `deletedAt` is set cannot confirm a disabled account.
5. **Soft-deleted account password reset** — a reset link issued before
   `deletedAt` cannot update the password or create a new session.

Both HTTP suites keep a real `AppModule`, `@nestjs/authentication`
services, and Prisma/PostgreSQL. The `Mailer` test spy captures links
without sending actual messages; auth guards and validation remain active.
Tests run against the guarded `TEST_DATABASE_URL`, with isolated
per-user cleanup. Only IP throttling is bypassed for test isolation.

## Non-goals and compatibility

These tests demonstrate exactly-once token consumption **within each
two-request race**; they are not a large-scale load test or proof of
unbounded throughput. The tests do not assume whether invalid links
are represented as HTTP 400 or 404 after account soft-delete, but they
require denial and preserved account state.

Changes are **tests and documentation only**. No application behavior,
database schema or migrations, dependencies, token TTLs, routes or CI
settings change.

Do not merge before all required GitHub Actions gates pass on the
latest commit, the final diff is reviewed and the PR is Ready for review.
