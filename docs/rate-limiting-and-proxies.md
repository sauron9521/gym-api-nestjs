# Distributed rate limiting and trusted proxy configuration

The API continues to use the NestJS global throttler at **10 requests / 60 seconds**
with its existing stricter @Throttle limits on authentication routes.
Rate limiting uses a per-process memory store by default, and can use one
shared Redis store when multiple API replicas serve traffic.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `REDIS_URL` | unset | Optional `redis://` or `rediss://` URL. When set, **all** throttling uses shared Redis. |
| `TRUSTED_PROXY_CIDRS` | unset | Comma-separated list of **source addresses/networks** of trusted reverse proxies. |
| `TEST_REDIS_URL` | unset | Dedicated Redis service for the real integration suite, not used by the production app. |

For local development:

```sh
docker compose up -d postgres redis
# If you want to test the shared Redis counter:
# REDIS_URL=redis://127.0.0.1:6379
```

For a production deployment behind a reverse proxy:

```dotenv
REDIS_URL=rediss://:password@redis.internal:6380
TRUSTED_PROXY_CIDRS=10.10.0.0/16,192.168.40.15
```

Replace the example networks with the **actual source IPs/CIDRs** of your
controlled proxy. The API must not be publicly reachable except through
the trusted proxy if the proxy's source addresses can be spoofed or if
ingress paths use different numbers of hops. The edge proxy must overwrite
or sanitize the incoming `X-Forwarded-For`, `X-Forwarded-Host` and
`X-Forwarded-Proto` headers. Do **not** set `TRUSTED_PROXY_CIDRS` to
`0.0.0.0/0`, `::/0`, `true` or a numeric hop count. In a direct-access
deployment, leave the option empty so client-supplied forwarding headers are
ignored.

Existing `@Throttle` decorators continue to enforce the same IP limits.
In addition, `POST /auth/password-reset/forgot` now has a second guard
that limits each normalized email to 5 requests per hour from any IP,
with HMAC-blinded account keys and the same Redis or memory storage.
See [account recovery policy](auth-account-recovery-rate-limiting.md).
The single-instance in-memory mode remains compatible for local development
and existing installations. **For multiple replicas, configure Redis before
scaling**; otherwise each replica maintains independent limits.

## Redis operation and failure modes

- All instances use the same namespaced SHA-256-hashed keys. Raw client
  addresses, route names and credentials are never stored as Redis key text.
- A single atomic Lua script updates a fixed-window counter and, if configured,
  a separate block-duration key. Redis TTLs release keys automatically.
- The Redis URL is never printed in logs. Connection and script errors log
  only stable event names.
- **Fail closed:** if `REDIS_URL` is configured but Redis is unreachable,
  the rate-limiting storage returns `503 Service Unavailable` instead of
  silently falling back to process-local memory.
- Redis is not used for sessions or other application caches in this PR.
  This intentionally changes the throttle storage backend only.

The Compose Redis container binds port 6379 to `127.0.0.1` and uses a
persistent volume; do not expose it to the public Internet. In real
production, use a private-network Redis with authentication, TLS when
crossing untrusted networks, suitable monitoring and persistence.

## Testing

- Unit: configuration rejects wide-open trust and invalid URLs; local limiter
  remains compatible; Redis connection failures fail closed.
- HTTP: forged `X-Forwarded-For` is ignored unless the source proxy is
  explicitly trusted; nested forwarding chains stop at the first untrusted hop.
- Real Redis integration: two separate Nest HTTP apps share their counter,
  requests across instances are atomic, and blocked clients reset after TTL.
- Existing auth rate-limit tests remain untouched (registration, login,
  verification, refresh/revoke). CI runs Redis 7 alongside PostgreSQL.

Rollout: set `REDIS_URL` for each API replica, verify Redis health and
permissions, set `TRUSTED_PROXY_CIDRS` to controlled proxy source networks,
then deploy. Keep Redis access private; monitor 429 and 503 rates.

## Endpoint-aware limits

| Endpoint | Requests per 60 seconds per client |
| --- | ---: |
| `GET /exercises`, `GET /exercises/:id` | 60 |
| `GET /workouts`, `GET /workouts/:id` | 60 |
| `GET /workout-analytics/summary`, `GET /workout-analytics/exercises/:exerciseId` | 20 |
| Other endpoints without overrides (including writes) | 10 |
| `POST /auth/login`, `POST /auth/register` | 3 |

These limits retain the existing IP/proxy tracker and distributed Redis storage.
Higher read limits reduce unnecessary 429 responses during normal browsing;
write and authentication limits remain conservative. These are operational
starting points: tune them using observed 429 rates and load testing.
