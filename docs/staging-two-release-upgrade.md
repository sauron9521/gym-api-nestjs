# Two separately signed GHCR releases: manual staging upgrade and runtime-only rollback (PR #162)

This is a **manual, ephemeral, GitHub-hosted staging rehearsal**. The
workflow file is `.github/workflows/staging-upgrade-rollback.yml` and
its name in Actions is **Manual two-release staging upgrade and runtime
rollback**. It never deploys a real staging server or touches a production
database. It is not triggered by commits or pull requests. No production
credentials, SSH keys or repository write permissions are used.

**Do not substitute the same image digest for both versions.** This workflow
requires two different, successfully signed, published **source commits**,
**runtime OCI digests** and **migration OCI digests**, and verifies the older
source is an ancestor of the newer source. An unsigned old image cannot pass.

## 1. Inputs and when it can run

The first release is **already published and signed**:

- Previous publication: [GHCR publish #43215694463](https://github.com/sauron9521/gym-api-nestjs/actions/runs/43215694463)
- Previous `runtime_digest`:
  `ghcr.io/sauron9521/gym-api-nestjs@sha256:8469d46662304325063c145383cd9d32ce34fb4c3b05d9e7747353618246e0d4`
- Previous `migrate_digest`:
  `ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:97bd2b4cbfd41678fa9afdb011ba753285df6c33de772181ddf5fd9e4fba0c9f`
- Previous `source_sha`: `026afc1df232617dc54ca57fc65206cea818c2a0`
- Previous `publish_sha`: `a7338262714091ac5ccc48a6e4e88b6407823490`

**The second signed release does not exist yet.** After this PR merges,
wait for successful `main` CI, then manually create a **new** Release
Candidate at the newer `main` SHA and run the already established signed
GHCR publisher. Copy both **new OCI digest references** from the successful
`ghcr-digests-...` receipt. Record the new candidate `source_sha`
and its publish job's `publish_sha` separately. Publishing a new
candidate requires passing Grype critical-severity gates and all
four GHCR provenance/SPDX attestations; no existing tags are overwritten.

Only after both published releases exist:

1. Go to **Actions → Manual two-release staging upgrade and runtime
   rollback → Run workflow**, select `main`.
2. Supply **eight strings**:
   - `previous_runtime_digest`, `previous_migrate_digest`
   - `previous_source_sha`, `previous_publish_sha`
   - `target_runtime_digest`, `target_migrate_digest`
   - `target_source_sha`, `target_publish_sha`
3. Select `confirm_upgrade=REHEARSE_SIGNED_UPGRADE_ROLLBACK`, then
   launch the workflow. Default `NO_REHEARSAL` refuses execution.

Full image refs must contain `@sha256:<64 hex>`; `latest`, mutable tags,
cross-repository images, incomplete commit SHAs, duplicate digests,
and reversed or unrelated GitHub source commits are rejected.
`source_sha` identifies the **image's original build**;
`publish_sha` identifies the **trusted signed OCI-publisher workflow**.
The two are usually different and never interchangeable.

## 2. What each stage checks

1. **Identity, ancestry and signatures:** verify the old source precedes
   the new source in this repository history. For each of four exact
   digests, verify both GitHub SLSA and SPDX OCI attestations from the
   repository's `publish-ghcr.yml`, bound to that release's publisher
   commit and `main`. Only after successful checks pull and inspect
   all four images for non-root `node` user, `linux/amd64`,
   matching digest and revision label.
2. **Disposable services:** fresh PostgreSQL 17, Redis 7 and avatar
   volume on an isolated Docker bridge. No DB/Redis ports are exposed.
   API is only reachable via runner loopback `127.0.0.1:31848`.
3. **Previous migrations and runtime:** apply the **old signed
   migration image** against an empty disposable DB. Start the
   **old signed runtime image** with read-only root, tmpfs, dropped
   capabilities, no privilege escalation and CPU/memory/PID limits.
   Require Docker `healthy` and HTTP 200 / `status: ok` from both
   `/health/live` and `/health/ready`.
4. **Synthetic functional checks:** create a user via the real HTTP API,
   validate login, issue/refresh JWT tokens, authorize `GET /users/me`,
   update first name and decimal weight `81.25`. SMTP is intentionally
   loopback-refused, and the registration's retry flow is tested; real
   mail is never sent. Secrets remain only in a mode-0600 local file.
5. **Private backup:** `pg_dump` the **populated test DB** to a private
   runner temp file, check custom-format readability using `pg_restore
   --list`, and verify SHA-256 before touching the database schema.
   This is **not a production backup or a restore drill**.
6. **Forward migration and backward compatibility:** run **new signed
   migration image** while old API is still active. Confirm old API
   remains ready and that the synthetic account/profile and its
   fractional weight are still accessible. A breaking schema change
   aborts the rehearsal.
7. **Upgrade runtime:** gracefully stop and replace the old
   container with the **new signed runtime** using the same database,
   persistent avatar volume and JWT signing key. Verify exact running
   digest, readiness, login and preserved profile.
8. **Runtime-only rollback:** gracefully replace the new runtime with
   the **previous signed runtime**. **Do not run old migrations, restore
   the database or downgrade the schema.** Verify the previous runtime
   works against the **new target schema**, and that login/profile
   data remain intact.
9. **Evidence and cleanup:** the workflow records seven strictly ordered
   checkpoints and only produces a **passed** receipt after all have
   completed. It uploads `staging/upgrade-evidence.json` for 30 days,
   or a limited **failed** receipt when possible. The GitHub job's
   final conclusion takes precedence. Always delete synthetic
   credentials, the test DB backup, private checkpoint state, Docker
   services and volumes, and the isolated network.

## 3. Approval and rollback interpretation

The success evidence explicitly includes:

- All seven milestones complete and both digest pairs verified.
- `rollback=previous-runtime-on-target-schema` — runtime only.
- `databaseDowngradePerformed=false`.
- `productionContacted=false` and `productionReleaseApproval=false`.

**A green Actions run is not authorization to deploy to production.**
It confirms only a single synthetic user/profile survives the specific
old → new → old transition in a fresh disposable test database. It
does not guarantee compatibility with real production data, other
collections/programs/exercises, external authentication infrastructure,
SMTP, public TLS proxies, concurrency, billing or production load.

Before production approval, an operator still needs:

- Verified, encrypted **off-host PostgreSQL + avatar backups** and a
  successful isolated **restore** rehearsal.
- Real dedicated persistent staging host with TLS, production-like
  configuration, monitoring/alert routing and a restored *anonymized*
  representative dataset. No copied live credentials.
- Reviewed **forward-only Prisma migration** and confirmed
  previous-runtime compatibility with the migrated schema.
- Operational maintenance window, expected current digest,
  rollback target, release change log, approval identities and
  incident contacts.
- Successful preflight and human-authorized `apply` using
  [production-digest-deployment.md](production-digest-deployment.md).
  No automatic production rollout or schema rollback is created here.

If the rehearsal fails after applying new migrations, **do not
automatically downgrade** even the staging DB. Inspect the failing
phase; the disposable runner and database are removed in cleanup.
Never use this workflow with a production PostgreSQL URL or credentials.

The previous **unsigned** GHCR publication before PR #156 is unsuitable
for the preceding-release slot. If a second signed candidate is
unavailable, this test remains deliberately unrun rather than
presenting a same-image restart as a real between-version rollback.
