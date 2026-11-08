# Environment configuration (PR #32)

The application validates configuration using Zod at NestJS startup.
Run `npm run config:validate` to validate without connecting to PostgreSQL.

## Local development and test

Copy `.env.example` into an untracked `.env` file. Set a PostgreSQL
URL, JWT secret, APP_URL, JWT_ISSUER and CORS_ORIGINS. NODE_ENV defaults
to development if omitted; production deployments **must set it explicitly**.

In development and test, omitting SMTP_URL uses LogMailTransport. This can
print email verification/password reset links and **must never be used in
production logs**. Set NODE_ENV=test for CI.

## Production requirements

- NODE_ENV=production (set explicitly in deployment configuration).
- DATABASE_URL must be a valid PostgreSQL URL.
- JWT_SECRET must be cryptographically random with at least 32 UTF-8 bytes
  (for example, generate via `openssl rand -base64 48`); do not commit it.
- JWT_ISSUER and APP_URL must use HTTPS without embedded credentials.
- CORS_ORIGINS must be a comma-separated list of exact HTTPS origins,
  without path, trailing slash, wildcard or credentials.
- SMTP_URL must use `smtps://` (implicit TLS, typically port 465) and
  MAIL_FROM must be a valid sender. Percent-encode special characters in
  SMTP credentials; provide secrets via your secret manager.
- ENABLE_OPENAPI defaults to false. PORT defaults to 3000.

This PR deliberately requires implicit TLS (`smtps://`) in production.
STARTTLS on port 587 needs a separately tested require-TLS transport
configuration and is not enabled by merely using `smtp://`.
A successful environment check validates *syntax and policy*, not SMTP
connectivity, DNS, credentials, certificate validity, or email deliverability.
Verify those with a staging smoke test.

Do not print environment dumps or mail transport URLs in logs. Failed
validation reports only field names and safe policy messages.

The avatar store remains local in this PR; multi-instance production
deployments require persistent shared/object storage in a later PR.
