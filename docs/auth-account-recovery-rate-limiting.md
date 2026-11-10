# Account-level password recovery throttling — PR #120

## Why another limit?

`POST /auth/password-reset/forgot` already has a **3 requests per minute per
client IP** throttle. An attacker controlling many IPs can bypass that limit
for one target mailbox. We now add a second **5 requests per hour per
normalized address** limit. Both limits apply; neither replaces the other.

| Layer | Threshold | Tracker | Storage |
| --- | --- | --- | --- |
| Existing `@Throttle` IP guard | 3 per 60 seconds | Trusted-proxy-derived client IP | Memory or Redis |
| Account recovery guard | 5 per 3,600 seconds | HMAC-SHA256 of normalized email | The same storage backend |

The account guard is wired **only** to the forgot-password route. No new
database tables, migrations, external services or user-lookup operations are
required.

## Privacy and anti-enumeration

1. Normalize email through `trim().normalize('NFC').toLowerCase()` in the
   request DTO and in the guard; casing and surrounding whitespace share
   one quota. The same normalization is used by the user repository.
2. Validate syntax before allocating an account counter. Invalid/oversized
   request bodies are left to normal DTO validation and the IP guard.
3. Build the account identity key using **HMAC-SHA256 with domain separation**
   and the existing shared `JWT_SECRET`. The store performs a further hash
   for its Redis key namespace. Neither Redis keys nor in-memory keys contain
   raw addresses. Do not log the raw recovery address, HMAC input or result.
4. Never look up a user in the guard. Both registered and unknown email
   addresses receive the same 202 success body below the threshold and 429
   once their **own** email quota is exhausted. No existence-dependent
   status is introduced.
5. A blocked request never reaches the reset service and therefore cannot
   create another email token or submit a message.

Be aware that account-based limits can themselves be abused to temporarily
deny a target additional reset emails. This is a tradeoff against mailbox
flooding, not a complete anti-DoS or anti-enumeration solution. Avoid exposing
per-email counts in API responses or metrics.

## Shared deployment behavior

The guard reuses `DistributedThrottlerStorage`:
- In single-instance development without `REDIS_URL`, counters are in
  process-local memory.
- With `REDIS_URL`, all instances share atomic Redis counters via the
  existing Lua script. Set the same `JWT_SECRET` on every instance so HMAC
  keys match; rotating that secret resets address-specific quotas.
- When Redis is configured but unavailable, storage throws 503. It must
  **never silently downgrade** to process-local rate limiting.
- Existing proxy trust rules and per-IP throttles remain in force.

Production replicas **must** configure a shared Redis instance; otherwise
they each enforce independent address counters.

## Tests

- Unit: stable HMAC for case/whitespace variants, no raw email in keys,
  five-per-hour window, blocked 429, fail-closed propagation, oversized
  invalid input, DTO normalization and validation.
- Real HTTP + PostgreSQL: six forgot attempts for one real mailbox from
  six different trusted-proxy client IPs produce five 202 and one 429,
  no sixth email or stored token; the same response threshold applies to
  a nonexistent mailbox with no mail generated.
- Two real Redis-backed HTTP apps: ten **concurrent** requests for the
  same normalized mailbox share a single counter; exactly five are accepted
  and five rejected, while another mailbox has an independent quota.
- Existing IP-throttle, Redis failure handling and proxy-trust tests run
  unchanged in CI.

## Compatibility

The public route remains `POST /auth/password-reset/forgot`. It accepts
case-insensitive and surrounding-whitespace email variants through the
existing DTO pipeline. Other password reset steps, verification routes,
session/JWT TTLs and login behavior are unchanged.

No Prisma schema changes, migrations, dependencies or CI modifications.
The new **429** after five hourly requests for one mailbox is intentional
and applies equally to known and unknown addresses.

Require green CI on the final PR head and review before merging.
