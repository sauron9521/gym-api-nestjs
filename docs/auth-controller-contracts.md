# Auth HTTP controller contract coverage (PR #103)

## Purpose

The auth feature already keeps five HTTP controllers in `controllers/` and existing tests in `test/controllers/`. This PR completes the missing controller-level regressions and preserves the public routes and response codes without modifying authentication logic.

## Controllers and routes

- `AuthController`: registration and sign-in.
- `PasswordResetController`: forgot password and reset (request accepted vs invalid/expired link).
- `EmailVerificationController`: verification and resend.
- `TokensController`: issue, refresh, and revoke access/refresh token.
- `SessionsController`: list, revoke one, sign-out and sign-out-everywhere.

The new route registry test verifies all **13** verb/path combinations and the preserved controller registration order, shared `auth` prefix, default/explicit HTTP status codes, rate limits and the shared `AuthNoStoreInterceptor` metadata.

`auth.module.ts` now imports controllers via their own relative `.js` paths rather than a barrel. Existing controller unit tests also import the concrete controller files directly. The `controllers/index.ts` compatibility export is intentionally left in place for any other consumers.

## Security and compatibility

The new unit tests verify service delegation and failure semantics for previously untested password-reset and token endpoints (generic unauthorized credentials, invalid reset link, MFA flag, refresh/revoke token values and error propagation). No new fields or sensitive values are logged or returned.

All existing class/method `@Public()` annotations, authorization requirements, response bodies, throttling, `AuthNoStoreInterceptor`, DTOs, session/token behaviors, OpenAPI declarations and database operations remain unchanged.

Verification requires all existing lint, build, unit, integration/E2E, OpenAPI, coverage, dependency audit and Docker CI gates before merge.
