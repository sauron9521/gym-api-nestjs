#!/usr/bin/env bash
# Consistent DB dump + best-effort avatar archive for the single-host deployment.
# The two artifacts are NOT an atomic cross-resource snapshot; see runbook.
set -Eeuo pipefail
umask 077

usage() {
  echo 'Usage: DATABASE_URL=... AVATAR_VOLUME=gym-api_avatars bash scripts/backup-production.sh /secure/backup-root' >&2
  exit 2
}

[[ "$#" -eq 1 && -n "$1" ]] || usage
[[ -n "${DATABASE_URL:-}" ]] || { echo 'DATABASE_URL is required' >&2; exit 2; }
avatar_volume="${AVATAR_VOLUME:-gym-api_avatars}"
[[ "$avatar_volume" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || {
  echo 'Invalid AVATAR_VOLUME name' >&2
  exit 2
}
for binary in pg_dump pg_restore docker tar sha256sum mktemp; do
  command -v "$binary" >/dev/null 2>&1 || {
    echo "Missing required command: $binary" >&2
    exit 2
  }
done

root="$1"
[[ ! -L "$root" ]] || { echo 'Backup root must not be a symlink' >&2; exit 2; }
mkdir -p -- "$root"
[[ -d "$root" && -w "$root" ]] || { echo 'Backup root not writable' >&2; exit 2; }
docker volume inspect "$avatar_volume" >/dev/null || {
  echo 'Avatar volume not found; no backup created' >&2
  exit 2
}

# Generate a never-overwritten directory. Do not print DB URLs or passwords.
destination="$(mktemp -d "$root/gym-api-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")"
finished=false
cleanup() {
  if [[ "$finished" != true && -n "$destination" && -d "$destination" ]]; then
    rm -rf -- "$destination"
  fi
}
trap cleanup EXIT

pg_dump --format=custom --no-owner --no-acl \
  --file="$destination/postgres.dump" --dbname="$DATABASE_URL"
pg_restore --list "$destination/postgres.dump" >/dev/null

# Read-only volume mount, no network access or extra capabilities, output
# restricted to the private backup directory. Never embed DB credentials.
docker run --rm --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=volume,src=$avatar_volume,dst=/avatars,readonly" \
  --mount "type=bind,src=$destination,dst=/backup" \
  alpine:3.21 tar -czf /backup/avatars.tar.gz -C /avatars .
tar -tzf "$destination/avatars.tar.gz" >/dev/null

(
  cd "$destination"
  sha256sum postgres.dump avatars.tar.gz > SHA256SUMS
  sha256sum --check --status SHA256SUMS
)
{
  printf 'created_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'avatar_volume=%s\n' "$avatar_volume"
  printf 'format=postgresql-custom-plus-tar-gzip\n'
  printf 'consistency=non-atomic-cross-resource\n'
} > "$destination/MANIFEST.txt"
finished=true
echo "Backup verified: $destination"
