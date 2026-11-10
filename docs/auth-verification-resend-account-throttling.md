# Verification resend: authenticated per-user rate limiting — PR #121

## Motivation and policy

The endpoint `POST /auth/email/verification` is authenticated and already
limits the client IP to **3 requests per 60 seconds**. This does not prevent
mailbox flooding from many IP addresses or multiple sessions.

A second, independent guard now limits each **unverified user to five
verification resends per hour** (60-minute fixed window). Both quotas apply:

| Guard | Tracker | Limit | Storage |
| --- | --- | --- | --- |
| Existing global `ThrottlerGuard` | Trusted client IP | 3/min | Existing memory/Redis backend |
| `VerificationResendRateLimitGuard` | Authenticated user ID, HMAC-blinded | 5/hour | Same `DistributedThrottlerStorage` |

Authentication is required before the user guard is evaluated. The new guard
uses the server-validated `request.user.id`, **not a caller-supplied email or
header**. Multiple sessions for the same user and changes to source IP
therefore share one account quota. It does not look up any user or allocate
an anonymous counter. The existing `401` for unauthenticated requests and
`409` for already verified accounts are preserved.

Keys are HMAC-SHA256 with domain separation
(`auth:verification:resend:user:v1`) under the existing shared
`JWT_SECRET`, and the storage hashes them a second time for the Redis key
namespace. No user ID, email, cookie, or raw token is used as a Redis key.
The verification quota has a separate namespace from password recovery.

A blocked request returns `429 Too Many Requests` with
`Cache-Control: no-store` before invoking the email-verification service.
No extra email token or mail submission occurs. The HTTP session remains
valid when the resend quota is exhausted. This does not modify the
verification link TTL or disable email confirmation.

## Distributed deployments and failure modes

With `REDIS_URL`, all API replicas share the existing atomic Redis
fixed-window counter. **Production replicas must use a shared Redis
deployment** and a consistent `JWT_SECRET`. If Redis becomes unavailable,
the storage fails closed with 503 rather than falling back to per-process
memory. Without `REDIS_URL`, local single-process development retains
existing in-memory counter behavior.

The same trusted proxy/IP configuration continues to apply to the
3/minute IP guard. A per-user quota can be abused to temporarily prevent
further resends; this is a tradeoff against mailbox flooding. Monitor
429/503 rates and give end users an appropriate UI cooldown message.

## Regression coverage

- Guard unit tests: user ID opacity, cross-session key stability,
  per-user isolation, 429, missing authentication and Redis 503.
- Real `AppModule` + PostgreSQL + HTTP: two browser sessions and
  five distinct client IPs produce five 202 responses then one 429.
  Exactly five tokens and emails are produced; a different user is
  unaffected, and both sessions remain valid.
- Preserve unauthenticated 401, already-verified 409 and no mail side
  effects for those requests.
- Two separate Redis-backed HTTP apps: ten simultaneous requests for
  one user result in exactly five 202 and five 429; another user has an
  independent quota.

Email sending is intercepted only in tests; no external email is sent.
Integration fixtures use the dedicated guarded PostgreSQL test database.

## Scope

No Prisma schema or migration changes, no new packages, and no changes
to login, password reset, session revocation, token validation or
verification confirmation. The only intentional API behavior change
is 429 after five accepted resends for the same user within one hour.
