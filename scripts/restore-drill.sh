#!/bin/sh
# Restore a verified PostgreSQL archive into an operator-provisioned EMPTY
# disposable database. Never creates, drops or truncates any database.
set -eu
umask 077

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo 'Usage: restore-drill.sh BACKUP_DIRECTORY' >&2
  exit 2
fi
if [ "${RESTORE_DRILL_CONFIRM:-}" != 'I_ACKNOWLEDGE_ISOLATED_RESTORE' ]; then
  echo 'Explicit RESTORE_DRILL_CONFIRM is required' >&2
  exit 2
fi
if [ -z "${RESTORE_DATABASE_URL:-}" ]; then
  echo 'RESTORE_DATABASE_URL is required' >&2
  exit 2
fi
if [ -n "${DATABASE_URL:-}" ] && [ "$RESTORE_DATABASE_URL" = "$DATABASE_URL" ]; then
  echo 'Restore database must differ from DATABASE_URL' >&2
  exit 2
fi

archive="$1"
if [ ! -d "$archive" ] || [ -L "$archive" ]; then
  echo 'Backup directory missing or symlinked' >&2
  exit 2
fi
for name in postgres.dump avatars.tar.gz SHA256SUMS MANIFEST.txt; do
  if [ ! -s "$archive/$name" ] || [ -L "$archive/$name" ]; then
    echo "Missing backup component: $name" >&2
    exit 2
  fi
done
for binary in psql pg_restore sha256sum tar; do
  command -v "$binary" >/dev/null 2>&1 || { echo "Missing command: $binary" >&2; exit 2; }
done

(
  cd "$archive"
  sha256sum -c SHA256SUMS >/dev/null
  pg_restore --list postgres.dump >/dev/null
  tar -tzf avatars.tar.gz >/dev/null
) || { echo 'Backup validation failed; restore was not attempted' >&2; exit 1; }

# Resolve the actual connected name rather than trusting the URL pathname.
# The target MUST be separately provisioned and empty; no CREATE/DROP is used.
database_name="$(psql -X -Atq -v ON_ERROR_STOP=1 --dbname="$RESTORE_DATABASE_URL" \
  -c 'SELECT current_database()')" || { echo 'Restore target unreachable' >&2; exit 1; }
case "$database_name" in
  *_restore_test) ;;
  *) echo 'Refusing to restore outside a *_restore_test database' >&2; exit 2 ;;
esac
table_count="$(psql -X -Atq -v ON_ERROR_STOP=1 --dbname="$RESTORE_DATABASE_URL" \
  -c "SELECT COUNT(*) FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'")" || exit 1
if [ "$table_count" != '0' ]; then
  echo 'Restore database is not empty; refusing to overwrite existing data' >&2
  exit 2
fi

pg_restore --exit-on-error --single-transaction --no-owner --no-acl \
  --dbname="$RESTORE_DATABASE_URL" "$archive/postgres.dump"

verified="$(psql -X -Atq -v ON_ERROR_STOP=1 --dbname="$RESTORE_DATABASE_URL" \
  -c "SELECT CASE WHEN to_regclass('public.users') IS NOT NULL AND to_regclass('public._prisma_migrations') IS NOT NULL THEN 'ok' ELSE 'missing' END")" || exit 1
if [ "$verified" != 'ok' ]; then
  echo 'Restored schema is missing required tables' >&2
  exit 1
fi
printf 'Isolated PostgreSQL restore passed: %s\n' "$database_name"
printf 'Avatar archive integrity checked; avatar extraction requires a disposable volume.\n'
