#!/usr/bin/env bash
# Verify integrity and freshness of the most recently named completed backup.
# Run on a trusted host; do not expose the backup root to untrusted writers.
set -Eeuo pipefail
umask 077

[[ "$#" -eq 1 && -n "$1" ]] || { echo "Usage: verify-backup-freshness.sh BACKUP_ROOT" >&2; exit 2; }
root="$1"
[[ -d "$root" && ! -L "$root" ]] || { echo "Backup root missing or unsafe" >&2; exit 2; }
max_hours="${BACKUP_MAX_AGE_HOURS:-26}"
[[ "$max_hours" =~ ^[0-9]{1,3}$ ]] || { echo "Invalid BACKUP_MAX_AGE_HOURS" >&2; exit 2; }
max_hours=$((10#$max_hours))
(( max_hours >= 1 && max_hours <= 168 )) || { echo "BACKUP_MAX_AGE_HOURS must be 1..168" >&2; exit 2; }

for binary in sha256sum pg_restore tar date; do
  command -v "$binary" >/dev/null 2>&1 || { echo "Missing command: $binary" >&2; exit 2; }
done

shopt -s nullglob
latest=''
for candidate in "$root"/gym-api-20??????T??????Z-*; do
  [[ -d "$candidate" && ! -L "$candidate" ]] || continue
  if [[ -z "$latest" || "$candidate" > "$latest" ]]; then
    latest="$candidate"
  fi
done
[[ -n "$latest" ]] || { echo "No completed backup directory found" >&2; exit 1; }

for name in postgres.dump avatars.tar.gz SHA256SUMS MANIFEST.txt; do
  [[ -s "$latest/$name" && ! -L "$latest/$name" ]] || {
    echo "Latest backup missing or unsafe: $name" >&2
    exit 1
  }
done

created="$(sed -n 's/^created_utc=//p' "$latest/MANIFEST.txt")"
[[ "$created" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || {
  echo "Backup manifest timestamp missing or malformed" >&2
  exit 1
}
created_epoch="$(date -u -d "$created" +%s)" || { echo "Backup timestamp invalid" >&2; exit 1; }
now="$(date -u +%s)"
age="$((now - created_epoch))"
(( age >= -300 && age <= max_hours * 3600 )) || {
  echo "Latest backup is stale or has a future timestamp" >&2
  exit 1
}

(
  cd -- "$latest" &&
  sha256sum --check --status SHA256SUMS &&
  pg_restore --list postgres.dump >/dev/null &&
  tar -tzf avatars.tar.gz >/dev/null
) || { echo "Latest backup integrity verification failed" >&2; exit 1; }

printf 'Verified latest backup: %s (age_seconds=%s)\n' "$latest" "$age"
