#!/usr/bin/env bash
# No production credentials, Docker daemon or PostgreSQL server required.
set -Eeuo pipefail
umask 077
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/bin" "$work/avatars" "$work/backups"
printf 'sample-avatar\n' > "$work/avatars/image.png"

cat > "$work/bin/pg_dump" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "${FAIL_PG_DUMP:-0}" != 1 ]] || exit 42
for arg in "$@"; do
  case "$arg" in
    --file=*) printf 'PGDMPtest-data' > "${arg#--file=}";;
    --dbname=*) if [[ -n "${MOCK_PG_DUMP_URL_LOG:-}" ]]; then
      printf '%s' "${arg#--dbname=}" > "$MOCK_PG_DUMP_URL_LOG"
    fi;;
  esac
done
MOCK

cat > "$work/bin/pg_restore" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == '--list' && -s "$2" ]]
MOCK

cat > "$work/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == volume && "$2" == inspect ]]; then
  [[ "${MOCK_MISSING_VOLUME:-0}" != 1 ]]
  exit
fi
[[ "$1" == run ]] || exit 41
printf '%s\n' "$@" > "$MOCK_DOCKER_LOG"
destination=''
for arg in "$@"; do
  case "$arg" in
    type=bind,src=*,dst=/backup)
      destination="${arg#type=bind,src=}"
      destination="${destination%,dst=/backup}"
      ;;
  esac
done
[[ -n "$destination" ]] || exit 41
tar -czf "$destination/avatars.tar.gz" -C "$MOCK_AVATAR_DIR" .
MOCK
chmod 700 "$work/bin/"*
export PATH="$work/bin:$PATH"
export DATABASE_URL='postgresql://test:test@localhost:5432/test'
export AVATAR_VOLUME='gym-api_avatars'
export MOCK_DOCKER_LOG="$work/docker-args"
export MOCK_AVATAR_DIR="$work/avatars"
export MOCK_PG_DUMP_URL_LOG="$work/pg-dump-url"

bash "$repo_root/scripts/backup-production.sh" "$work/backups" > "$work/output"
backup_dir="$(find "$work/backups" -mindepth 1 -maxdepth 1 -type d -print -quit)"
[[ -n "$backup_dir" ]] || { echo 'No backup created' >&2; exit 1; }
(
  cd "$backup_dir"
  sha256sum --check --status SHA256SUMS
  [[ -s postgres.dump && -s avatars.tar.gz && -s MANIFEST.txt ]]
  tar -xOf avatars.tar.gz ./image.png | grep -q 'sample-avatar'
)
grep -qx -- '--network' "$work/docker-args"
grep -qx -- 'none' "$work/docker-args"
grep -qx -- '--read-only' "$work/docker-args"
grep -qx -- '--cap-drop' "$work/docker-args"
[[ "$(cat "$MOCK_PG_DUMP_URL_LOG")" == "$DATABASE_URL" ]] || {
  echo 'Legacy DATABASE_URL fallback changed' >&2; exit 1
}
# Operators may use a separate libpq URL with no Prisma-specific schema option.
BACKUP_DATABASE_URL='postgresql://backup:pwd@localhost:5432/gym_app?sslmode=require' \
  bash "$repo_root/scripts/backup-production.sh" "$work/backups" >/dev/null
[[ "$(cat "$MOCK_PG_DUMP_URL_LOG")" == 'postgresql://backup:pwd@localhost:5432/gym_app?sslmode=require' ]] || {
  echo 'BACKUP_DATABASE_URL override was ignored' >&2; exit 1
}

# Refuse missing credentials and invalid volume names.
if DATABASE_URL='' bash "$repo_root/scripts/backup-production.sh" "$work/backups" >/dev/null 2>&1; then
  echo 'Empty DATABASE_URL was accepted' >&2; exit 1
fi
if AVATAR_VOLUME='invalid/volume' bash "$repo_root/scripts/backup-production.sh" "$work/backups" >/dev/null 2>&1; then
  echo 'Unsafe AVATAR_VOLUME was accepted' >&2; exit 1
fi
if MOCK_MISSING_VOLUME=1 bash "$repo_root/scripts/backup-production.sh" "$work/backups" >/dev/null 2>&1; then
  echo 'Missing volume was accepted' >&2; exit 1
fi

# Failed dumps must not leave misleading partial backup directories.
before="$(find "$work/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)"
if FAIL_PG_DUMP=1 bash "$repo_root/scripts/backup-production.sh" "$work/backups" >/dev/null 2>&1; then
  echo 'Failed database dump returned success' >&2; exit 1
fi
after="$(find "$work/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)"
[[ "$before" -eq "$after" ]] || {
  echo 'Failed database dump left a partial backup' >&2; exit 1
}
echo 'Backup orchestration and failure safety smoke passed'
