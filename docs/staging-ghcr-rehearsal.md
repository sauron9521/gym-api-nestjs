# Ephemeral staging rehearsal for signed GHCR images (PR #160)

This **manually dispatched**, test-only GitHub Actions workflow is a
short-lived staging **rehearsal** on an isolated GitHub-hosted runner.
It **does not deploy** to any real staging or production server and has
no SSH credentials, production secrets, registry write permissions,
persistent endpoints or production database connections.

The job tests the exact **previously published** API runtime and Prisma
migrations OCI manifest digests, **without building or retagging either
image**. It is not invoked on PRs, pushes, scheduled events or releases.

## Prerequisites and operator inputs

Use only artifacts from a **successful** manual GHCR Publish run with
the enhanced dual SPDX/SLSA attestations and critical-vulnerability
scans. The publishing repository's GitHub Actions token needs
`packages: read` access to both packages. The job has
`contents: read` and `attestations: read`, never write permission.

Open **Actions → Manual staging smoke of verified GHCR images → Run workflow**
and select `main`. The following inputs are from the first successful
enhanced GHCR publication, run
[43215694463](https://github.com/sauron9521/gym-api-nestjs/actions/runs/43215694463):

| Input | Value |
| --- | --- |
| `runtime_digest` | `ghcr.io/sauron9521/gym-api-nestjs@sha256:8469d46662304325063c145383cd9d32ce34fb4c3b05d9e7747353618246e0d4` |
| `migrate_digest` | `ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:97bd2b4cbfd41678fa9afdb011ba753285df6c33de772181ddf5fd9e4fba0c9f` |
| `source_sha` | `026afc1df232617dc54ca57fc65206cea818c2a0` |
| `publish_sha` | `a7338262714091ac5ccc48a6e4e88b6407823490` |
| `confirm_staging` | `RUN_EPHEMERAL_STAGING` |

**Important:** `source_sha` describes the signed image build; `publish_sha`
describes the separate GitHub Actions commit that published and attested
the OCI digest. They are not interchangeable. For future releases use
the values from their own successful candidate and publisher runs.
The workflow rejects mutable tags, unknown GHCR namespaces, partial
SHAs and missing manual authorization before any container starts.

## What the rehearsal proves

1. Verify **both** OCI predicate types — SLSA v1 publish provenance
   and SPDX 2.3 SBOM — for **each** digest. Trust is constrained to
   `sauron9521/gym-api-nestjs`, its `publish-ghcr.yml` workflow,
   `main` and the exact publisher commit.
2. Pull **exact digest refs**, not `latest`, inspect the image IDs,
   source revision labels, platform (`linux/amd64`) and non-root
   `node` user against the requested signed source SHA.
3. Create one dedicated Docker bridge with fresh **PostgreSQL 17**,
   **Redis 7**, database `gym_app_staging_test` and disposable avatars
   volume. Neither DB nor Redis has published host ports; the
   PostgreSQL password is a fixed **disposable test-only** value and
   must never be reused outside this runner.
4. Run the exact **migrations image** against the new, isolated
   database. Only forward Prisma migrations are rehearsed; no external
   database or production credentials are ever supplied.
5. Launch the exact **runtime image** under production-like Docker
   restrictions: read-only root filesystem, temporary `/tmp`,
   non-root process, dropped Linux capabilities, no privilege
   escalation, CPU/memory/PID limits and isolated avatars storage.
   It uses a per-run random JWT secret, dummy HTTPS/SMTPS URLs and
   disposable Redis and PostgreSQL endpoints.
6. Wait for Docker's own `healthy` status, then independently
   probe `http://127.0.0.1:31848/health/live` and
   `/health/ready`. Each must return **HTTP 200** and JSON
   `status: "ok"`. Redis readiness and PostgreSQL readiness are
   therefore exercised; no privileged API endpoints are called.
7. Emit `staging/evidence.json` with only the run ID, source/publisher
   SHA, image digest refs and config IDs, migration outcome and safe
   endpoint/health statuses. It excludes all credentials and Docker
   environment inspection.
8. Upload the evidence for **30 days** and then remove the API,
   disposable PostgreSQL/Redis containers (including anonymous
   volumes), avatar volume and bridge network even on a failed run.

A failed workflow is **not** a partial production deployment. A failure
receipt is emitted when possible, but check the red Actions step for
the exact stage. No images are pushed to GHCR, and no existing GHCR
tags or packages are altered.

## Interpretation and limits

A successful run means these specific signed images can launch and
serve both health endpoints after applying their Prisma migrations on
a **fresh** test database with Redis. It does **not** prove that existing
production data will migrate safely, that external SMTP/TLS/CORS,
proxy trusted IPs, authorization or email delivery work, that
multi-replica deployment and rollback work, or that a real staging
server has been configured. There is **no permanent staging URL**.

Before production launch, a separate persistent staging server with
dedicated secrets, a restored anonymized database, a real HTTPS
reverse proxy, alert routing, user-auth and avatar tests is still
recommended. Apply production changes **only** through the
human-authorized, digest-pinned
[deployment procedure](production-digest-deployment.md), with
independently verified backups and reviewed schema compatibility.

## Troubleshooting

- **Attestation refused:** ensure `publish_sha` matches the main
  commit of the **publisher**, not the candidate build, and both
  digests belong to a successful attested GHCR run.
- **Package access denied:** permit the repository's Actions token to
  read both packages; never insert a PAT in the workflow inputs.
- **Database/Redis not ready:** this workflow uses only runner-local
  Docker containers; it never connects to an operator database.
- **Migration failure:** use the named migration step and its output;
  never skip migrations to make the smoke green.
- **Unhealthy API:** inspect the runtime step and synthetic config;
  failure logs must not include secrets.
- **Missing evidence:** an early checkout or identity error may
  prevent the receipt step from running. The job conclusion remains
  authoritative.

This is a staging **rehearsal**, not a release approval or a production
deployment. The already published OCI digests are not modified.


## Extended functional, migration and restart rehearsal (PR #161)

After the basic signed-digest staging smoke succeeds, the **same
manual runner-only** workflow now exercises the API over real HTTP,
using generated **synthetic credentials** in the disposable database:

- Unauthenticated `GET /users/me` must reject access with HTTP 401.
- `POST /auth/register` creates a new synthetic user. It must return
  HTTP 201, a non-sensitive response and a session cookie. SMTP points
  to `smtps://127.0.0.1:4465` **inside the isolated API container**:
  its connection is deliberately refused. The registration endpoint
  should still succeed with `verificationEmailStatus=RETRY_REQUIRED`,
  not turn persisted registration into HTTP 500. **No real email is sent**.
- `POST /auth/login` accepts the synthetic credentials, then
  `POST /auth/token` issues an access/refresh pair. `GET /users/me`
  must accept the bearer access token, and `PATCH /users/me` updates
  a safe synthetic `firstName` and exact decimal weight `81.25`.
  Refreshing the token must rotate it, and the new bearer token must
  still read the updated profile.
- The **same signed migrate digest** is invoked a second time against
  the **populated disposable database**. The test reauthenticates and
  verifies the synthetic account, weight and profile survive.
  This only establishes that *re-running the current forward migration
  sequence does not remove this synthetic data*.
- The **same signed runtime digest** is stopped gracefully and then
  restarted. Healthchecks must recover and the previously created
  account/profile must remain readable. This demonstrates restart
  recovery and persistent data, **not an upgrade or version rollback**.
- A separate `staging/functional-evidence.json` file records only
  safe pass/fail assertions, OCI image identities, and a mandatory
  `rollbackAcrossDifferentVersions: not-tested` statement. Generated
  email/password/access/refresh tokens are **never** included.
  Private `staging/functional-state.json` is ignored by Git and
  deleted before artifact upload; the isolated runner is destroyed.

**Limitations:** testing migration replay on the same source is not a
backward/forward compatibility test between two application versions.
An actual controlled upgrade and runtime-only rollback requires **two
distinct, verified and signed OCI runtime digests**, an independently
reviewed compatible DB migration, authorized approvals and a backup.
None of these are bypassed, and this workflow cannot be interpreted
as a completed production rollback drill or green-light for launch.

If a functional step fails, the GitHub Actions job is **red** even if
its earlier basic `staging/evidence.json` had reported passing
readiness. Inspect the **final job conclusion** and the separate
functional evidence receipt; absence of a success receipt means that
functional validation did not complete.
