# Relationship-history privacy regression audit (PR #110)

## Existing protections

The backend already tests identity isolation, role-scoped reads and historical
redaction for TERMINATED trainer–athlete relationships and training-program
assignments. Its PostgreSQL-backed suites exercise real Nest guards, HTTP
serialization and Prisma projections, not only mocked controller responses.

## New regression scenarios

1. Declined invitations: former trainers can see closed relationship metadata
   but not athlete email, profile fields, managed avatar keys or credentials.
2. Cancelled invitations: the trainer's cancellation response and later
   list/detail responses redact the athlete's email and profile information.
3. Re-engagement: starting a fresh ACTIVE relationship with the same athlete
   does not retroactively reveal personal data in a prior TERMINATED record.
   The currently active relationship still has its intended contact fields.
4. Program assignment history: a fresh ACTIVE trainer–athlete relationship
   must not restore contacts or workout details from an assignment linked
   to the prior TERMINATED relationship.
5. Contract-level guards: /users/me account and profile Prisma projections
   must never select password hashes, deletion metadata, auth sessions,
   refresh tokens or managed avatar storage keys.

## Test design

The two HTTP/PostgreSQL files reuse existing AppModule test bootstraps.
Fixtures use unique users, explicit cleanup and the existing test database
guard. Read assertions check both details and status-filtered lists, plus
unrelated-party access (404) and owner access (200). Re-engagement is tested
through the actual invitation/acceptance endpoints, not by spoofing roles.

Run npm test, npm run test:e2e, npm run test:cov and all required CI checks.
Only tests and this documentation change; there are no API, Prisma, migration
or permission changes.

Historical records intentionally retain relationship IDs, status and audit
timestamps. These tests prohibit unauthorized private *fields*, not access
to all history by a legitimate former participant.
