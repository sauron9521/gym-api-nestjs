# Authentication security policy (PR #34)

## Rate limits

These endpoints retain per-IP limits (60-second window) unless stated otherwise:

| Endpoint | Limit |
| --- | ---: |
| POST /auth/register | 3 |
| POST /auth/login | 3 (existing) |
| POST /auth/token | 3 (existing) |
| POST /auth/token/refresh | 20 |
| POST /auth/token/revoke | 10 |
| POST /auth/email/verify | 8 |
| POST /auth/email/verification | 3 (existing) |
| POST /auth/password-reset/forgot | 3 per IP, plus 5/hour per normalized email |
| POST /auth/password-reset/reset | 3 (existing) |

Other endpoints retain the existing default 10 requests per minute.

The built-in in-memory throttler is **per process**, not shared across replicas.
Its client tracker also requires a carefully configured trusted reverse proxy
to avoid tracking only a load balancer IP. Do not blindly trust
X-Forwarded-For. Configure shared Redis counters when running multiple API
replicas. The forgot-password route now has an additional five-per-hour
account-address quota (see [account recovery policy](auth-account-recovery-rate-limiting.md)).
Monitoring, account limits for other routes and abuse response remain future work.
IP throttles alone cannot prevent distributed guessing.

## Deleted account policy

Soft-deletion retains the normalized email under its unique constraint.
Registration of the same email returns 409. This prevents unverified
identity takeover while associated business records still exist.
Email reuse requires a separate account recovery/retention policy.

The credential and auth providers already reject deleted users. This PR
additionally rejects reads from SessionStore and RefreshTokenStore for
soft-deleted account owners, prevents updating their session activity, and
hides their sessions from listings.

Soft-delete does **not** physically remove or revoke persisted token rows
in this PR. Future account deletion should atomically revoke sessions and
refresh families, and implement data retention/anonymization requirements.

Existing session revocation is user-scoped. The application supports
sign-out-everywhere, refresh token rotation and family reuse detection,
which are covered by existing integration tests. JWT access tokens are
short-lived; after soft-delete, bearer user lookup rejects them immediately.

Do not log raw credentials, session cookies, refresh tokens or SMTP reset links.
