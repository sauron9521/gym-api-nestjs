# Verification email delivery after registration

## Problem

`POST /auth/register` creates the account and a login session **before**
submitting an email verification message. Previously an SMTP/provider
failure threw an HTTP error after those mutations had committed. A client
retrying registration then received `409 User with the same email already
exists`, with no clear recovery guidance.

## New response behavior

The registration endpoint still returns **201 Created** with the existing
safe user fields. It now also returns a required
`verificationEmailStatus` property:

| Status | Meaning | Client action |
| --- | --- | --- |
| `SUBMITTED` | The email service accepted the submission request | Ask user to check email and spam folder |
| `RETRY_REQUIRED` | Email submission failed after account + session creation | Inform user that account was created; offer resend |

A successful submit is **not a delivery receipt** from the mailbox.
Do not display the word "delivered" solely because the field is
`SUBMITTED`.

`RETRY_REQUIRED` must not trigger another `POST /auth/register`. The
client already has the session cookie from the successful registration,
so it can call the existing authenticated endpoint:

```http
POST /auth/email/verification
Cookie: __Host-sid=...
```

- `202 Accepted`: another send request was accepted.
- `503 Service Unavailable`: submission failed again; offer retry later.
- `409 Conflict`: the email address has already been verified.
- `401 Unauthorized`: session expired/missing; sign in and resend.

The existing rate limits still apply. Do not repeatedly hammer the
resend endpoint. After a lost session or page reload, use
`POST /auth/login` instead of repeating registration.

## Security and operational constraints

- The registration success body continues to exclude `passwordHash`,
  refresh/session tokens, and soft-delete fields.
- Failure logging uses stable event names only:
  `AUTH_REGISTRATION_VERIFICATION_EMAIL_SUBMISSION_FAILED` and
  `AUTH_VERIFICATION_EMAIL_RESEND_FAILED`. Never log provider errors,
  email addresses, token URLs or passwords.
- A mail failure is swallowed **only after** the account and session
  succeeded. User creation and session failures retain their original
  error behavior.
- This PR intentionally provides **user-triggered recovery**, not
  background guaranteed delivery. A transactional outbox/queue with
  retries, provider idempotency and operator alerting is a separate
  production feature, not claimed by this change.
- No Prisma schema changes or migrations.

## Tests

The PR covers success, submission failure, session preservation,
duplicate-signup behavior, resend failure (`503`), subsequent
successful resend, safe logs and the OpenAPI response contract. CI
also runs the rest of the authentication integration, E2E and security
suite.
