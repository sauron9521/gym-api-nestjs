# API error handling (PR #33)

The global `ApiExceptionFilter` is registered with `APP_FILTER`.
It handles thrown errors from Nest controllers and providers and returns a
stable JSON envelope while preserving the original HTTP status and existing
application-level error message.

Example for a domain conflict:

```json
{
  "statusCode": 409,
  "code": "CONFLICT",
  "message": "Only active assignments can be completed.",
  "requestId": "8474d59f-fbd7-48ac-b1f0-0f84d9e5ba83",
  "timestamp": "2026-11-08T21:00:00.000Z",
  "error": "Conflict"
}
```

The optional `error` property is included only when supplied by Nest
in its HTTP exception response. Validation messages may remain a string array.

## Prisma fallback mappings

| Prisma code | HTTP | Public code | Message |
| --- | --- | --- | --- |
| P2002 | 409 | UNIQUE_CONSTRAINT_CONFLICT | Resource already exists |
| P2003 | 409 | FOREIGN_KEY_CONFLICT | Resource relationship constraint failed |
| P2025 | 404 | RESOURCE_NOT_FOUND | Resource not found |
| Other Prisma/unhandled errors | 500 | INTERNAL_SERVER_ERROR | Internal server error |

If a service has a more precise business interpretation (e.g. a concurrency
conflict rather than a missing record), it must catch the Prisma code itself
and throw an appropriate Nest HTTP exception; the global fallback does **not**
replace domain exception handling.

## Security and compatibility

- No SQL strings, Prisma metadata, internal stack traces, request bodies or
  error details from unexpected failures are returned to HTTP clients.
- Unexpected server failures are logged as safe error categories plus request ID.
- Request IDs are server-generated UUIDs, not trusted from request headers.
- `X-Request-ID` matches the error response body.
- These extra response fields are an intentional **additive error response
  contract change**. Existing `message` and `statusCode` fields are preserved.
- The filter is only responsible for thrown exceptions. Errors generated
  before Nest request handling (e.g. reverse proxy, body-parser hard limits)
  and successful responses are outside this contract.
- Full request-scoped tracing and correlation on successful responses belong
  to a future logging/observability PR.
