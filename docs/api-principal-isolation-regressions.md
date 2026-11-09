# API principal isolation: cross-module security regression suite (PR #61)

## Motivation

Separate module tests already exercise per-resource authorization, but they do not comprehensively pin **mixed session/JWT principals across multiple modules** or cross-account refresh-token revocation. Those are important regressions when auth providers, actor context, Prisma selects, or repositories are refactored.

## End-to-end scope

A dedicated PostgreSQL integration suite creates two real athlete users with different sessions and access/refresh token families, plus private owner fixtures: a body measurement, a personal workout and a private exercise. No controller, service, or repository mocks are used; only the rate-limit guard is overridden so intentional repeated negative security cases cannot be throttled. The app uses exactly the two global validation pipes configured in production.

- **Identity spoofing:** forged `X-User-Id`, `X-Role`, `X-Forwarded-User` and query `userId` cannot override authenticated cookie or JWT identity; account response never includes credential/soft-delete/avatar storage fields.
- **Provider precedence:** when a valid session cookie and JWT from different users are sent together, the registered session provider takes precedence (existing order 0 before JWT order 1).
- **Measurement IDOR:** the other account cannot read, patch or delete the owner's measurement via either auth mode. All denials are 404 with uniform `requestId` and `no-store`; the data is unchanged.
- **Mass assignment:** cannot inject `userId` on list/create endpoints or account `id`/`role` in profile updates.
- **Workout BOLA:** the other account cannot read, edit, start or complete the owner's workout even when it knows the UUID; persisted status and owner remain unchanged.
- **Private exercise visibility:** guest and foreign-user reads do not reveal the private exercise. Unauthorized modifications remain 403 (current contract), and do not leak the exercise's name or alter it.
- **Token-family isolation:** `sign-out-everywhere` for one user revokes only that user's refresh tokens; the other user's family can still rotate.

## Compatibility

Only tests/documentation are added. No runtime behavior, HTTP contracts, authentication/authorization logic, schema or migrations change. The suite intentionally asserts the current 403 behavior for forbidden exercise modifications rather than silently changing a documented API contract.

## CI

The new suite runs under the existing PostgreSQL integration/E2E job alongside current unit, lint, build, OpenAPI, coverage, dependency audit and Docker production smoke gates.
