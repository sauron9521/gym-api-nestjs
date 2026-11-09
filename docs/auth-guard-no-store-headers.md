# Early auth no-store headers — PR #59

## Rationale

The existing `AuthNoStoreInterceptor` runs *after* Nest authentication, authorization and throttling guards. For example, an unauthenticated `GET /auth/sessions` can be rejected with `401` before the controller-level interceptor executes. The successful-response no-store policy from PR #58 is therefore insufficient for guard-generated responses.

## Implementation

Register `AuthNoStoreMiddleware` in `AppModule.configure` after the existing request-context middleware for all HTTP methods. The middleware runs before guards/pipes/controllers and sets `Cache-Control: no-store` only when Express `request.path` matches the exact `/auth` route boundary or any subpath (case-insensitive, matching Express's default routing). Unrelated paths such as `/authentication`, `/authentic`, `/users/me` and `/health/live` remain untouched. No URL/query string or bearer/cookie value is inspected or logged.

The controller-level `AuthNoStoreInterceptor` remains in place as a defense-in-depth policy for controller-only Nest applications and isolated tests. Both set the *same value*; there are no duplicate HTTP headers and this is idempotent.

## Compatibility and safeguards

- No change to HTTP bodies, status codes, authorization decisions, JWT/cookie/session behavior, request correlation or rate limits.
- The policy applies to guard-level `401`/`403` and throttler `429` responses for auth routes, plus successful auth endpoints and validation errors.
- The rule is scoped to requests that enter the Nest/Express middleware pipeline. Errors rejected by a reverse proxy before Nest must be configured separately at that proxy.
- Prisma schema and migrations, API types and dependencies are unchanged.

## Verification

- Middleware unit tests cover auth root/nested routes, boundary matching, case variation and non-auth paths.
- HTTP throttling tests verify `429` responses carry `Cache-Control: no-store` for register, verification, refresh and revoke.
- Integration tests import the real `AppModule` to verify an authentication guard rejection (`401`), validation rejection (`400`) and unaffected health response (`200`).
- CI requires Prisma checks, lint, TS build, unit tests, PostgreSQL integration/E2E, OpenAPI, coverage, Docker smoke and dependency audit.
