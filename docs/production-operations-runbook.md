# Production operations: backup, restore and incident response

This is the **single-host** production deployment defined in
[`compose.prod.yml`](../compose.prod.yml) with an externally managed
PostgreSQL database and local Docker volume `gym-api_avatars`.
It is not a high-availability design or an automatic backup scheduler.

## 1. Preflight and access

Run on a trusted operator host with:

- PostgreSQL `pg_dump`/`pg_restore` client at least as recent as the server
  major version, Docker CLI and access to the production avatar volume
- A writable, private directory on encrypted storage with capacity for both
  the full database export and all avatars
- A restricted `DATABASE_URL` in the **environment** (never in shell history
  or committed files). Protect process arguments, backup files, secrets and
  operator access; the script uses `--dbname` to hand the URL to `pg_dump`
- The actual Docker volume name, usually `gym-api_avatars`; verify with
  `docker volume ls` if `COMPOSE_PROJECT_NAME` was customized

Check PostgreSQL access and deployment health before taking a snapshot.
Use a separate backup read-only database role where possible; the database
still needs consistent privileges to dump all schemas and tables.

## 2. Produce and validate a backup

```bash
# Obtain DATABASE_URL using a secret manager; do NOT echo or commit it.
# Export the variable securely in the operator's session.
export AVATAR_VOLUME=gym-api_avatars
bash scripts/backup-production.sh /srv/private/gym-backups

# The script prints a newly-created backup directory.
cd /srv/private/gym-backups/gym-api-<generated-timestamp-and-id>
sha256sum --check SHA256SUMS
pg_restore --list postgres.dump >/dev/null
tar -tzf avatars.tar.gz >/dev/null
```

The script refuses missing credentials, invalid/nonexistent avatar volumes
and unwritable destinations. It performs a PostgreSQL custom-format dump
with `--no-owner --no-acl`, then a read-only archive of the volume using
a locked-down Alpine helper container with no network. It verifies the
PostgreSQL archive listing and tar archive, writes SHA-256 checksums, and
cleans up incomplete backups. `umask 077` keeps output files private.

**Consistency limit:** the PostgreSQL dump is transactionally consistent
*within the database*. It is **not atomic across PostgreSQL and avatar
files**, so concurrent uploads may leave a mismatched snapshot. For exact
cross-resource recoverability, put the API in maintenance mode or block
avatar mutations during backup. The daily orphan cleanup could also affect
unreferenced files; it never deletes active references. Schedule during a
low-traffic maintenance window. This script does not freeze the API.

Use encrypted off-site storage for at least one additional copy, and keep
those backups **outside the host/volume and outside GitHub**. Decide retention,
access control and deletion according to the operator's data policy. For a
starting policy, capture backups daily, alert when the last verified backup
is more than 24 hours old, and rehearse restore monthly. These are
**recommendations**, not configured automation or guarantees.

## 3. Restore drill — isolated environment only

This is a **manual** runbook. The repository intentionally provides no
automatic destructive restore command. Never point the following commands
at the production `DATABASE_URL`.

1. Provision an *empty, isolated* PostgreSQL database and new dedicated
   avatar volume. Set `RESTORE_DATABASE_URL` to that database and
   independently verify the hostname/database name.
2. Verify the files **before** restoration:

   ```bash
   cd /srv/private/gym-backups/gym-api-<id>
   sha256sum --check SHA256SUMS
   pg_restore --list postgres.dump >/dev/null
   tar -tzf avatars.tar.gz >/dev/null
   ```

3. Load the database into that **empty** disposable database:

   ```bash
   # NEVER use DATABASE_URL pointing at production.
   pg_restore --exit-on-error --single-transaction --no-owner \
     --no-privileges --dbname="$RESTORE_DATABASE_URL" postgres.dump
   ```

4. Restore avatars to a dedicated disposable volume:

   ```bash
   docker volume create gym-api-restore-drill-avatars
   docker run --rm --network none --read-only --cap-drop ALL \
     --security-opt no-new-privileges \
     --mount type=volume,src=gym-api-restore-drill-avatars,dst=/avatars \
     --mount "type=bind,src=$PWD,dst=/backup,readonly" \
     alpine:3.21 tar -xzf /backup/avatars.tar.gz -C /avatars
   ```

5. Boot a **staging** API with the restored database and dedicated volume;
   verify `/health/live`, `/health/ready`, login and a real user avatar.
   Confirm no external email is sent and that staging JWT/session secrets
   differ from production. Record drill date, restore duration, data checks
   and issues. Delete only the disposable restore database/volume when
   verification is complete.

If an archive contains unexpected paths or fails validation, stop and
investigate rather than extracting it. Do not use a restore drill to
overwrite an existing database or shared avatar volume.

## 4. Health, logs and initial monitoring

- `GET /health/live` (public, not throttled): checks only the API process;
  it should remain **200** even when dependencies are unavailable.
- `GET /health/ready` (public, not throttled): **200** only if the
  PostgreSQL `SELECT 1` succeeds **and**, when `REDIS_URL` is configured,
  the Redis throttling connection answers `PING`. Without `REDIS_URL`,
  in-memory throttling does not need Redis. Dependency failures return a
  generic **503** with no database/Redis addresses or credentials.
- Docker HEALTHCHECK already calls `/health/ready`; note Docker's
  `restart: unless-stopped` does **not** restart merely unhealthy containers.
  Use an external monitor to page the operator / stop routing to unready APIs.

Proposed external monitor settings (not provisioned by this repository):

| Signal | Initial trigger | Response |
| --- | --- | --- |
| Readiness | 3 failed probes in 2 minutes | Check PostgreSQL and Redis connectivity |
| Liveness | 2 failed probes in 1 minute | Inspect process, logs, OOM, host availability |
| HTTP 5xx rate | 5% for 5 minutes, meaningful traffic | Inspect recent deploys and request IDs |
| HTTP 429 rate | Sustained unexpected increase | Check clients, rate limits, trusted proxies |
| PostgreSQL | Connections, disk, backup WAL and query latency | Check DB provider metrics |
| Redis (optional) | Outages, latency, memory eviction, key count | Fix rate-limit store before scaling |
| Avatar volume | Free disk/inodes below 15% | Expand capacity, check orphan cleanup |
| Backup | No verified backup in 24 hours | Investigate job and schedule a restore drill |

NestJS production JSON logs already include correlation request IDs,
method, **route patterns** (not URLs or raw identifiers), status code,
duration and safe error codes. Forward stdout/stderr to a central system
with retention and redaction. Do not add raw cookies, JWTs, request bodies,
client IPs, PostgreSQL/Redis URLs, or email verification links.

**One-shot report (PR #125):** `npm run monitoring:report` reads a
caller-supplied, time-bounded JSON-lines log batch, computes 429/503 and
Redis transition counts, and optionally probes both health endpoints.
See [production monitoring starter](production-monitoring-alerts.md) for
CLI usage, initial thresholds, the exit-code contract and privacy rules.
This is not a scheduled task or externally configured alert.

An optional host-side systemd timer and Prometheus textfile example are
available in [monitoring integration](production-monitoring-integration.md).
The runner reads only a restricted JSONL file from a separately provisioned
trusted collector; it does not require the Docker socket or docker group.
These templates are **not installed or activated automatically**; an
operator must provision node_exporter, permissions, a secure scrape target
and notification routing. Docker socket access is equivalent to root.

**No Nest /metrics endpoint, OpenTelemetry collector or external alerting
service is provisioned.**

## 5. Incident/rollback decision tree

1. Determine whether the API is down (`/health/live`) or only its
   dependencies are unready (`/health/ready`). Inspect JSON logs by
   `requestId` while keeping secrets out of incident tickets.
2. If Redis is unavailable with `REDIS_URL` set, the throttler intentionally
   **fails closed** (503). Restore Redis; don't remove rate limiting during an
   attack. Check the proxy allowlist is accurate.
3. If PostgreSQL is down, fix provider networking, credentials, capacity and
   availability. Do not launch untested schema downgrade commands.
4. For a bad application release, roll the runtime image back to the prior
   verified tag **only when DB migrations are backward-compatible**. Stop
   traffic during the change and recheck both health endpoints.
5. If restore is genuinely necessary, declare a maintenance window,
   confirm a clean restore drill, involve an authorized DB operator and
   record irreversible data loss risks since the backup timestamp.

The separately-built migration image applies **forward Prisma migrations**.
There is no automatic Prisma down-migration or general roll-back of data.
Document RPO/RTO objectives and test them against real backup sizes before
public launch. Production restore authorization stays with the operator.
