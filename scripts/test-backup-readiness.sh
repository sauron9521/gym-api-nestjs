#!/usr/bin/env bash
# Offline regression checks: no live database, Docker socket or credentials.
set -Eeuo pipefail
umask 077
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/bin" "$work/backups" "$work/backup"/{avatars,unused}
root="$work/backups"
latest="$root/gym-api-20261112T033000Z-TEST1234"
mkdir -p "$latest"
printf 'PGDMPfixture\n' > "$latest/postgres.dump"
mkdir -p "$work/avatar-content"
printf 'avatar-fixture\n' > "$work/avatar-content/avatar.png"
tar -czf "$latest/avatars.tar.gz" -C "$work/avatar-content" .
(
  cd "$latest"
  sha256sum postgres.dump avatars.tar.gz > SHA256SUMS
  printf 'created_utc=%s\navatar_volume=gym-api_avatars\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > MANIFEST.txt
)

cat > "$work/bin/pg_restore" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${1:-}" == '--list' ]]; then
  [[ -s "${2:-}" ]]
  exit
fi
printf 'restore-requested\n' >> "$MOCK_RESTORE_LOG"
MOCK
cat > "$work/bin/psql" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$*" in
  *current_database*) printf '%s\n' "${MOCK_DB_NAME:-isolated_restore_test}" ;;
  *COUNT*) printf '%s\n' "${MOCK_TABLE_COUNT:-0}" ;;
  *to_regclass*) printf '%s\n' "${MOCK_RESTORED_OK:-ok}" ;;
  *) exit 41 ;;
esac
MOCK
chmod 700 "$work/bin/"*
export PATH="$work/bin:$PATH"
export MOCK_RESTORE_LOG="$work/restore.log"
: > "$MOCK_RESTORE_LOG"
export DATABASE_URL='postgresql://user:password@localhost:5432/production'
export RESTORE_DATABASE_URL='postgresql://user:password@localhost:5432/isolated_restore_test'
export RESTORE_DRILL_CONFIRM='I_ACKNOWLEDGE_ISOLATED_RESTORE'

bash "$repo/scripts/verify-backup-freshness.sh" "$root" > "$work/out"
grep -q 'Verified latest backup' "$work/out"

# The restore command must enforce confirmation and a disposable empty target.
if RESTORE_DRILL_CONFIRM='' sh "$repo/scripts/restore-drill.sh" "$latest" >/dev/null 2>&1; then
  echo 'Missing restore confirmation was accepted' >&2; exit 1
fi
if RESTORE_DATABASE_URL="$DATABASE_URL" sh "$repo/scripts/restore-drill.sh" "$latest" >/dev/null 2>&1; then
  echo 'Production database URL was accepted' >&2; exit 1
fi
if MOCK_DB_NAME='production' sh "$repo/scripts/restore-drill.sh" "$latest" >/dev/null 2>&1; then
  echo 'Non-disposable database name was accepted' >&2; exit 1
fi
if MOCK_TABLE_COUNT='1' sh "$repo/scripts/restore-drill.sh" "$latest" >/dev/null 2>&1; then
  echo 'Non-empty restore target was accepted' >&2; exit 1
fi
[[ ! -s "$MOCK_RESTORE_LOG" ]] || { echo 'Unsafe restore was attempted' >&2; exit 1; }

sh "$repo/scripts/restore-drill.sh" "$latest" > "$work/restore-output"
grep -q 'Isolated PostgreSQL restore passed' "$work/restore-output"
grep -q 'restore-requested' "$MOCK_RESTORE_LOG"

if BACKUP_MAX_AGE_HOURS=0 bash "$repo/scripts/verify-backup-freshness.sh" "$root" >/dev/null 2>&1; then
  echo 'Invalid age policy was accepted' >&2; exit 1
fi

# Tampering must fail BOTH freshness and restore checks before a DB write.
printf 'corrupted\n' >> "$latest/postgres.dump"
if bash "$repo/scripts/verify-backup-freshness.sh" "$root" >/dev/null 2>&1; then
  echo 'Corrupted backup passed freshness check' >&2; exit 1
fi
: > "$MOCK_RESTORE_LOG"
if sh "$repo/scripts/restore-drill.sh" "$latest" >/dev/null 2>&1; then
  echo 'Corrupted archive was accepted for restoration' >&2; exit 1
fi
[[ ! -s "$MOCK_RESTORE_LOG" ]] || { echo 'Corrupt archive reached pg_restore' >&2; exit 1; }

# Recompute checksums for the following independent timestamp test.
(
  cd "$latest"
  sha256sum postgres.dump avatars.tar.gz > SHA256SUMS
)
sed -i 's/^created_utc=.*/created_utc=2020-01-01T00:00:00Z/' "$latest/MANIFEST.txt"
if bash "$repo/scripts/verify-backup-freshness.sh" "$root" >/dev/null 2>&1; then
  echo 'Stale backup was accepted' >&2; exit 1
fi
if bash "$repo/scripts/verify-backup-freshness.sh" "$work/backup/unused" >/dev/null 2>&1; then
  echo 'Empty backup directory was accepted' >&2; exit 1
fi
echo 'Backup freshness, corruption and isolated-restore safeguards passed'
