# Auth token lifecycle regression coverage — PR #111

## Scope and current baseline

The existing HTTP/PostgreSQL test suite already verifies a single refresh-token
rotation, reuse-triggered family revocation, explicit family revocation and
sign-out-everywhere. The two token-store contract suites cover the
`@nestjs/authentication` storage interface, including concurrency-related
contracts. This PR adds narrowly scoped missing boundary regressions; it does
not duplicate the existing basic happy paths.

## Added checks

| Test | Security invariant |
| --- | --- |
| Two logins, revoke the first | Each issued refresh-token family is independent: revoking one does not invalidate the other, which can still rotate and authenticate. |
| Two logins, replay the first | Theft/replay quarantine is scoped to the compromised family. An unrelated family's refresh flow still succeeds. |
| Owner soft-deleted | New token issuance, refresh and existing bearer access all reject the deleted principal. Persisted refresh/family rows are not silently erased by these denied requests. |
| Refresh-family cleanup at cutoff | Families with `familyExpiresAt <= cutoff` and their tokens are deleted; a live family survives even if its individual token expires earlier. |

The API tests use a real Nest application, HTTP requests and PostgreSQL with
the repository's dedicated `TEST_DATABASE_URL` guard. The cutoff test runs
against the real `PrismaTokenStore` and PostgreSQL. Fixture users are deleted
after each API test or at the end of the store suite; foreign-key cascades
remove their token data.

## Compatibility and risk

Tests and documentation only. No production behavior, API routes, token
lifetimes, auth-provider priority, Prisma schema, migrations, dependency
versions or CI gates are changed. Do not weaken the refresh-token family
revocation semantics in response to a failing regression test: investigate
the application behavior first.

## Verification

Run the repository's normal lint, build, unit test and PostgreSQL E2E jobs
against the current PR HEAD. These tests depend on the usual dedicated test
database; they cannot be verified against a production database.

Keep the PR Draft until **every required GitHub Actions check** is green for
the latest commit and the final diff is reviewed. **Do not merge automatically.**
