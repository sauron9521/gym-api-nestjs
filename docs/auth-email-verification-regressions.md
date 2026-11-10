# Email verification HTTP security regressions — PR #117

## Background

Existing auth tests cover registration and resend outcomes (including SMTP
failure), controller-level email-verification responses, and atomic email-token
consumption in the Prisma store. They did not validate the whole
**registration → emailed verification link → HTTP verification → persisted
emailVerified flag** sequence with the real framework services.

## Added HTTP/PostgreSQL scenarios

1. **Token owner isolation and replay**: verifying account A's link while a
   cookie for account B is sent confirms only A. The response exposes the
   verified email and boolean, not token/store metadata; a second use of
   the same link returns HTTP 400.
2. **Invalid and expired links**: random invalid tokens and a genuine link
   whose stored expiry was moved into the past both return HTTP 400.
   The account remains unverified.
3. **Resend lifecycle**: a logged-in unverified account can request another
   email with HTTP 202. Its new link confirms the account; a further resend
   is rejected with HTTP 409 and no extra email is submitted. A request
   without authentication returns HTTP 401.
4. **Address binding**: if the user's email changes in PostgreSQL after
   issuance but before verification, the old link cannot confirm the
   new email address.

All checks use **AppModule, the real Nest authentication providers and
Prisma/PostgreSQL**. A test `Mailer` spy captures the submitted email links
without delivering messages to real mailboxes. The same global validation
pipes used by the application are enabled. Test users are isolated by UUID
and cleaned up through FK cascades. The `TEST_DATABASE_URL` safety guard
is active; only IP throttling is overridden to avoid cross-test coupling.

## Compatibility

Tests and documentation only. No changes to routes, production code,
Prisma schema/migrations, email-token TTLs, dependencies or CI configuration.
The tests assert HTTP status and the persisted user state, not just mocked
controller invocations.

A successful submission to the test mailer proves only that the application
issued the link, **not delivery to an actual mailbox**.

## Validation

Keep this PR Draft until all required GitHub Actions gates pass for the
latest commit and the diff is reviewed. Do not merge automatically.
