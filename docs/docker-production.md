# Docker production deployment (PR 40)

## Overview

The existing docker-compose.yml remains local development only. It creates
a PostgreSQL 17 instance with a test database. It must not be used as the
production deployment configuration.

The Dockerfile provides four stages:

- build: npm ci, Prisma 7 client generation, NestJS compilation and HTML
  email template assets;
- migrate: one-shot Prisma CLI with schema/migrations (runs as node);
- production-deps: removes dev-only npm dependencies after the build;
- runtime: non-root Node 22, compiled dist, production dependencies,
  healthcheck, and writable avatars only via an external volume.

The long-running runtime image intentionally excludes the Prisma CLI,
TypeScript compiler, test files, raw source and local environment files.

## Environment and secrets

Create an untracked .env.production file containing all the following:

  DATABASE_URL=postgresql://user:password@db-host:5432/database
  JWT_SECRET=replace-with-strong-random-secret
  JWT_ISSUER=https://api.example.com
  APP_URL=https://app.example.com
  CORS_ORIGINS=https://app.example.com
  SMTP_URL=smtps://user:password@mail.example.com:465
  MAIL_FROM="Gym API <no-reply@example.com>"

All example values are placeholders, not production credentials.
The application validates the environment at startup. JWT_SECRET must be
a properly random value of at least 32 bytes; production URL values
must use HTTPS and email delivery must use SMTPS.

Use a secure secret manager when possible. Docker environment variables
are visible to privileged operators via docker inspect. Do not pass real
credentials to docker build or commit .env.production to Git. URL-encode
special characters in SMTP and PostgreSQL credential components.

## Deployment commands

Run these in order from the repository root, after checking the database
is reachable from containers:

1. Validate Compose interpolation:

    docker compose --env-file .env.production -f compose.prod.yml config --quiet

2. Back up the production database and avatar volume.
3. Apply pending migrations once, using the separate migration target:

    docker compose --env-file .env.production -f compose.prod.yml --profile ops run --build --rm migrate

4. Build/start or update the API:

    docker compose --env-file .env.production -f compose.prod.yml up -d --build api

5. Inspect containers and probe readiness:

    docker compose --env-file .env.production -f compose.prod.yml ps
    curl -f http://127.0.0.1:3000/health/ready

The container always listens on port 3000. To change its host binding, set
API_PORT in .env.production. The host port is bound to loopback
(127.0.0.1) by default; configure a reverse proxy for external TLS/HTTPS,
secure cookies, firewalling, and request/time limits.

Use an external PostgreSQL service configured with appropriate backups,
TLS and network access. This deployment Compose file deliberately does
not deploy an unmanaged local production database, and has no test-db init
scripts. Never run db:seed or db:reset in production.

## Filesystem and lifecycle

The application container runs as non-root user node, has read-only root
filesystem, drops all Linux capabilities and uses no-new-privileges.
Only /tmp (tmpfs) and /app/uploads/avatars (a named volume) are writable.
Back up the named volume; local avatar storage is single-instance only.
Object storage is required before scaling to multiple application replicas.

Docker sends SIGTERM and allows 30 seconds for graceful shutdown.
NestJS already calls enableShutdownHooks(), which disconnects Prisma on
module shutdown. Deploy behind an upstream proxy with connection drain
settings and avoid in-flight requests during rolling replacements.

GET /health/live checks process responsiveness without querying DB;
GET /health/ready uses PostgreSQL SELECT 1. The Docker HEALTHCHECK uses
readiness so a database outage marks the container unhealthy.
Docker restart policies restart exited containers, not automatically
containers that are merely unhealthy; configure monitoring/orchestration
to act on health status. A DB outage during boot can prevent startup.

## CI scope and remaining production tasks

CI builds both Docker targets, runs the migration target against the
dedicated CI PostgreSQL database, starts the production runtime with
dummy SMTP/JWT settings, probes both health endpoints and checks shutdown.
No real external SMTP delivery or production database is contacted.

Before public launch: implement secret injection and rotation, backups and
restore tests, image registry/release pinning and signatures, monitoring,
TLS reverse proxy, and deployment rollback procedures. Revisit base image
digest pinning regularly. The production deployment described here is
a single-host baseline, not a multi-replica platform.
