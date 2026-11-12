# Manually approved production deployment by verified GHCR digest (PR #157)

This is an **operator-host procedure**, not remote GitHub Actions
deployment. It is intentionally disabled until an authorized operator
chooses a host, external PostgreSQL, Redis (optional), backups, trusted
proxy, secrets and rollback policy. Running CI or merging a PR does
not start any production service.

The base [single-host Compose](../compose.prod.yml) and its security
settings are preserved. [compose.digest.prod.yml](../compose.digest.prod.yml)
is an **opt-in override** with `build: !reset null`, supported by the
Docker Compose specification. It removes local builds for both API
runtime and migration, then replaces both image tags with exact
`ghcr.io/...@sha256:...` references. The script also enforces
`--no-build --pull never` during API startup. Docker Compose must
support `!reset` and the provided CLI flags; the actual merged config
is validated before any mutation.

## 1. Before you touch production

- Finish **main CI** and create a signed release candidate using the
  existing manual GitHub Actions workflow.
- Publish it using the enhanced **PR #156+** GHCR workflow, which must
  generate SPDX SBOMs, block critical vulnerabilities, sign two OCI
  digest attestation types and verify them. **Older GHCR images from
  before PR #156 don't have these OCI attestations and cannot pass
  this preflight.**
- Save both exact `@sha256` image refs from the successful publish job.
  Record the image's **SOURCE_SHA** (commit used for the signed build)
  and **PUBLISH_SHA** (commit which ran the trusted publishing workflow).
  They are **distinct identifiers** and can differ.
- Make a *verified backup* of the production PostgreSQL database and
  avatars following [production operations](production-operations-runbook.md).
  For an `apply` operation the backup directory must contain a valid
  `SHA256SUMS`, `postgres.dump` and `avatars.tar.gz`.
  The script re-checks all three archive formats/digests.
- Independently confirm Prisma migrations are backward compatible with
  the currently running API. **Application rollback NEVER undoes a
  Prisma schema/data migration.** Schedule a maintenance/drain window:
  a single-host Compose replacement is not zero-downtime.
- Prepare `DEPLOY_ENV_FILE` as an **absolute path** to the private
  `.env.production` already used by your host; do not commit or echo
  its contents. The script checks Compose by piping secret-bearing JSON
  directly to a private validator; it does not print the JSON.
- Authenticated Docker and GitHub CLI must be able to pull **private**
  GHCR images and verify GitHub attestations. Login on the trusted
  operator host using a narrowly scoped credential; do not put tokens
  into command arguments, CI YAML or repository files.
- Set `EXPECTED_CURRENT_IMAGE` to the **exact digest** of the existing
  running API container. For a genuine first deployment with **no**
  existing API container, use `none`. If an older local-build container
  is present (`gym-api:local`), the guard will deliberately refuse
  to replace it silently. Plan that conversion separately.

## 2. Supply deployment identities securely

Example shell session (replace *all* placeholders with real values):

```bash
export DEPLOY_ENV_FILE=/srv/private/gym-api/.env.production
export DEPLOY_RUNTIME_IMAGE='ghcr.io/sauron9521/gym-api-nestjs@sha256:REPLACE_WITH_64_HEX'
export DEPLOY_MIGRATE_IMAGE='ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:REPLACE_WITH_64_HEX'
export SOURCE_SHA=FULL_40_HEX_IMAGE_SOURCE_COMMIT
export PUBLISH_SHA=FULL_40_HEX_PUBLISH_WORKFLOW_COMMIT
export EXPECTED_CURRENT_IMAGE=none # only when absolutely no current container exists
```

Do not copy these placeholders as-is; strict validators refuse them.
For existing installations, `EXPECTED_CURRENT_IMAGE` must instead be
the approved existing image's full runtime digest. This prevents an
unreviewed replacement or a race with another operator.

## 3. Preflight: no production changes

```bash
bash scripts/production-digest-deploy.sh preflight
```

The script:
1. Rejects unpinned, mistyped, cross-repository, wrong-platform refs;
   requires source, publishing and previous-runtime identities.
2. Merges Compose and rejects any leftover `build`, unexpected
   published port, non-root/security policy drift or missing avatar
   volume. The API binds **only** to loopback.
3. Cryptographically checks **both** GitHub attestations for **both**
   exact GHCR digests, restricted to the trusted publisher workflow,
   `main` ref and `PUBLISH_SHA`.
4. Pulls the exact digests and verifies the container user `node`,
   platform `linux/amd64`, repository digests and OCI revision labels
   against `SOURCE_SHA`.
5. Confirms the current API container (if any) is **exactly** the
   `EXPECTED_CURRENT_IMAGE` supplied by the operator.

This preflight may pull images to the operator's Docker cache; it does
**not** create or replace containers, run migrations, push images or
modify the database.

## 4. Explicitly authorized deployment

Only after reviewing the preflight, backup and migration compatibility
on a trusted operator host:

```bash
export DEPLOY_LOCK_FILE=/srv/private/gym-api/deploy.lock
export BACKUP_DIR=/srv/private/gym-backups/gym-api-VERIFIED_BACKUP_DIRECTORY
export RUN_DB_MIGRATIONS=yes # or no, selected explicitly
export CONFIRM_DEPLOY=DEPLOY_VERIFIED_DIGEST
bash scripts/production-digest-deploy.sh apply
```

`apply` repeats preflight with an exclusive `flock` lock, validates
backup SHA-256, lists the PostgreSQL archive and the avatars tarball,
then **optionally** runs the one-shot, digest-pinned
`migrate` image using `--no-deps --pull never`. On successful
migration, Compose **recreates only API** using the exact pinned
runtime digest; it doesn't rebuild or start other services.

The script confirms the container uses that digest and waits for its
Docker healthcheck (backed by `/health/ready`). A failure exits
**nonzero**, preserving logs and requiring manual incident review;
there is **no automatic rollback of code or database**. Follow up with
external TLS endpoint checks, authentication smoke, traffic/error
metrics and backup freshness before declaring production healthy.

## 5. Explicit runtime-only rollback (never schema rollback)

Record a *previously signed and verified* runtime and migrate pair,
both source/publisher SHAs, and deployment approval **before updating**.
To roll back, review schema compatibility, set target refs/SHAs to the
previous approved release, set `EXPECTED_CURRENT_IMAGE` to the
newly deployed runtime digest, and run:

```bash
export RUN_DB_MIGRATIONS=no
export CONFIRM_DEPLOY=ROLLBACK_RUNTIME_ONLY
bash scripts/production-digest-deploy.sh rollback
```

This again verifies **all** signed OCI attestations and image identities,
locks the host and compares the running image before replacing only
the runtime container; it does **not** call the migration service.
If the database has changed incompatibly, **stop and escalate** to
the authorized DB operator. Never attempt arbitrary Prisma down
migrations or restore production from an unreviewed snapshot.

The guard does not override an unknown existing image, remove the
avatar volume, roll back a database, automatically retry a failure,
delete GHCR packages or run any command remotely from GitHub Actions.

## 6. Scope, CI and audit

PR CI runs pure unit tests of image/ref validation and reviews the
operator script for dangerous invocations; Docker CI **only validates
the fully merged, no-build Compose model** against synthetic refs.
No CI job authenticates to production, requests SSH credentials,
changes DNS, issues `docker compose up` on a real host or runs migrations
on real databases.

Store an operator change record privately with: deployment timestamp,
requested image digests, current and rollback digests, source and
publisher SHA, approved backup ID, migration outcome, health status
and sign-off. Do not commit secret-bearing production snapshots.

References: [Docker Compose merge and reset](https://docs.docker.com/reference/compose-file/merge/),
[GHCR signed release chain](ghcr-supply-chain.md),
[production operations](production-operations-runbook.md).
