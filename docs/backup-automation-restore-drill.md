# Opt-in backup automation and safe recovery drill

Production is a single-host Docker Compose API with **external PostgreSQL**
and named Docker volume \`gym-api_avatars\`. The existing
\`scripts/backup-production.sh\` creates a consistent PostgreSQL **custom dump**
and a separate avatar tar archive. Those two are **not an atomic snapshot**
of database and files.

## What this change automates

- Opt-in \`systemd\` oneshot service + daily timer at **03:30 local host time**
  (with up to 15 minutes of jitter and missed-run catch-up).
- A post-backup check that the newest named backup exists, is no more than
  26 hours old, has valid SHA256 hashes, a readable \`pg_restore --list\`
  dump, and a readable avatar tar archive.
- CI mock failure-path tests and a **real PostgreSQL 17 dump/restore**
  exercise into a disposable, empty \`gym_restore_drill_test\` database.
  CI also extracts avatars into a temporary Docker volume and deletes it.
- A reusable **guarded** restore script for an already created, empty
  \`*_restore_test\` database, with an explicit confirmation variable.

**Nothing here installs services, grants Docker privileges, configures
alert routing, creates production backups, uploads off-site copies or
performs production restores automatically.**

## Provision and enable (manual, trusted operator host)

1. Provision an encrypted, access-restricted filesystem at
   \`/srv/private/gym-backups\` (owner root, mode 0700). Set up encryption
   and **independent encrypted off-host replication** with a different
   trust boundary. Backup copies on the same server are not disaster
   recovery. Do not put backups, keys or real \`backup.env\` in Git.
2. Install the app checkout under \`/opt/gym-api\`. Check \`pg_dump\` and
   \`pg_restore\` are at least PostgreSQL 17, Docker is available,
   backup volume name is correct, and disk capacity is sufficient.
3. Copy \`ops/backup/backup.env.example\` to
   \`/etc/gym-api/backup.env\` as root, owner root, mode **0600**.
   Securely supply a backup-role \`DATABASE_URL\` (never expose it
   through shell history or application logs), and set \`AVATAR_VOLUME\`.
4. Verify a **manual** backup first and review its permissions:
   \`sudo bash scripts/backup-production.sh /srv/private/gym-backups\`.
   Ensure the \`DATABASE_URL\` is present only in the authorized process
   environment. Run
   \`sudo bash scripts/verify-backup-freshness.sh /srv/private/gym-backups\`.
5. Copy \`ops/backup/gym-api-backup.service\` and
   \`ops/backup/gym-api-backup.timer\` to \`/etc/systemd/system/\`.
   Review the paths and root/Docker privileges, then run:

   \`\`\`sh
   sudo systemctl daemon-reload
   sudo systemd-analyze verify /etc/systemd/system/gym-api-backup.service
   sudo systemctl enable --now gym-api-backup.timer
   systemctl list-timers gym-api-backup.timer
   \`\`\`

6. Inspect service logs and schedule a failed/missing-backup alert in
   **your external monitoring system**. The timer does not page anyone:

   \`\`\`sh
   systemctl status gym-api-backup.timer
   journalctl -u gym-api-backup.service --since yesterday
   sudo systemctl start gym-api-backup.service
   \`\`\`

The service is root because it accesses the Docker volume and database
backup credentials; Docker socket access is equivalent to root. Do not grant
this privilege to the API container or a general monitoring user. Root's
\`EnvironmentFile\` must remain outside the repository. The service uses
\`ProtectSystem=strict\`, \`UMask=0077\` and a dedicated writable backup
directory, but this is **not** a substitute for host isolation.

**Retention:** no deletion is automatic in this PR. Configure off-site
replication, immutability, retention and expiration as one reviewed
operation; do not delete the only good backup based on age. Monitor
capacity and failures. Monthly full recovery drills and RPO/RTO targets
must be measured for the actual production data volume.

## Verify freshness or diagnose a failure

\`\`\`sh
BACKUP_MAX_AGE_HOURS=26 bash scripts/verify-backup-freshness.sh /srv/private/gym-backups
\`\`\`

The command fails for a missing, stale, malformed or corrupt latest backup;
it deliberately checks the **newest** named backup, not an older healthy
copy that might mask a recent failed run. It does not establish archive
authenticity (the checksums are stored alongside the dump). Secure storage,
replication permissions and immutable/off-site copies remain required.

## Isolated PostgreSQL restore rehearsal

**Never run against a real application database.** Provision a separate,
**empty** database whose actual name ends with \`_restore_test\` and use
a credential authorized to restore to it. The script refuses a nonempty
target, disallows an identical source URL, and **never creates, drops,
truncates or cleans up a database**.

\`\`\`sh
# Provision the isolated DB separately. Do not copy production credentials.
export RESTORE_DATABASE_URL='postgresql://restorer@isolated-host/gym_restore_test'
export RESTORE_DRILL_CONFIRM='I_ACKNOWLEDGE_ISOLATED_RESTORE'
sh scripts/restore-drill.sh /srv/private/gym-backups/gym-api-<backup-id>
\`\`\`

The restore script validates SHA256, \`pg_restore --list\` and avatar tar
contents **before** contacting the target; after restore it checks
\`public.users\` and \`public._prisma_migrations\`. CI uses a PostgreSQL
17 client image and disposable targets to test real restore behavior.

The script **does not restore avatars**. For a complete staging rehearsal,
restore that tar archive into a **dedicated disposable Docker volume**
following the [production recovery runbook](production-operations-runbook.md).
Launch the staging API with isolated secrets and disabled outbound mail, then
verify login, avatars and representative data. Cleanup must be reviewed and
performed by the operator, only on disposable resources.

Backups are not atomic across PostgreSQL and avatar uploads. During a
planned full recovery snapshot, put avatar writes in maintenance mode.
Keep records of backup age, restore success, rehearsal duration and the
maximum data loss you can tolerate.

## What CI establishes and what it doesn't

The quality job runs offline safety tests, checks systemd units, and creates
a real custom PostgreSQL 17 dump of its **test** DB, restoring into a new
test DB. It exercises avatar extraction in a scratch Docker volume.

This validates the toolchain, not production permissions, external
replication, backup encryption, alert delivery, consistency under live
avatar writes, monthly drills or recovery time on full production data.
