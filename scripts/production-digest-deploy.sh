#!/usr/bin/env bash
# Operator-host only. No GitHub Actions SSH, registry push or automatic deploy.
set -euo pipefail
umask 077

mode="${1:-}"
if [[ $# -ne 1 || ! "$mode" =~ ^(preflight|apply|rollback)$ ]]; then
  echo "Usage: bash scripts/production-digest-deploy.sh preflight|apply|rollback" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
: "${DEPLOY_ENV_FILE:?Set absolute path to private production env file}"
: "${DEPLOY_RUNTIME_IMAGE:?Set digest-pinned published runtime image}"
: "${DEPLOY_MIGRATE_IMAGE:?Set digest-pinned published migration image}"
: "${SOURCE_SHA:?Set image source revision}"
: "${PUBLISH_SHA:?Set publisher workflow commit for OCI attestation verification}"
: "${EXPECTED_CURRENT_IMAGE:?Set previous runtime digest or none}"
if [[ "$DEPLOY_ENV_FILE" != /* || ! -f "$DEPLOY_ENV_FILE" || ! -r "$DEPLOY_ENV_FILE" ]]; then
  echo "Production env file must be an existing readable absolute path" >&2
  exit 1
fi

for executable in docker gh node; do
  command -v "$executable" >/dev/null || { echo "Missing $executable" >&2; exit 1; }
done

# Verify references before passing them to Docker or GitHub CLI.
node scripts/production-digest-guard.mjs refs

compose=(docker compose --env-file "$DEPLOY_ENV_FILE" \
  -f compose.prod.yml -f compose.digest.prod.yml)
# The guarded config is secret-bearing: only pipe it, never print it.
"${compose[@]}" --profile ops config --format json \
  | node scripts/production-digest-guard.mjs compose

if [[ "$mode" != preflight ]]; then
  : "${CONFIRM_DEPLOY:?Explicit operator confirmation required}"
  : "${DEPLOY_LOCK_FILE:?Absolute path to private lock file required}"
  if [[ "$DEPLOY_LOCK_FILE" != /* || -L "$DEPLOY_LOCK_FILE" ]]; then
    echo "Deployment lock file must be an absolute non-symlink path" >&2
    exit 1
  fi
  command -v flock >/dev/null || { echo "Missing flock" >&2; exit 1; }
  # Never concurrently replace the same single-host production container.
  exec 9>"$DEPLOY_LOCK_FILE"
  flock -n 9 || { echo "Another deployment is in progress" >&2; exit 1; }
  if [[ "$mode" = apply ]]; then
    [[ "$CONFIRM_DEPLOY" = DEPLOY_VERIFIED_DIGEST ]] || { echo "Invalid deploy approval" >&2; exit 1; }
    [[ "${RUN_DB_MIGRATIONS:-}" = yes || "${RUN_DB_MIGRATIONS:-}" = no ]] ||
      { echo "Explicit RUN_DB_MIGRATIONS=yes or no is required" >&2; exit 1; }
    : "${BACKUP_DIR:?A verified production backup is mandatory}"
    [[ "$BACKUP_DIR" = /* && -f "$BACKUP_DIR/SHA256SUMS" &&
      -f "$BACKUP_DIR/postgres.dump" && -f "$BACKUP_DIR/avatars.tar.gz" ]] ||
      { echo "Missing complete private backup" >&2; exit 1; }
    (cd "$BACKUP_DIR"; sha256sum --check --status SHA256SUMS)
    pg_restore --list "$BACKUP_DIR/postgres.dump" >/dev/null
    tar -tzf "$BACKUP_DIR/avatars.tar.gz" >/dev/null
    # Release provenance alone never authorizes deploying to a real host.
    # Require a private, current operator change approval bound to the exact
    # digest pair, current image, verified backup and maintenance window.
    # The actual backup archives are independently checked above.
    : "${PRODUCTION_RELEASE_REPORT:?Read-only verified release evidence file required}"
    : "${PRODUCTION_OPERATOR_APPROVAL_FILE:?Private host and operator approval required}"
    node scripts/production-readiness.mjs operator-gate
  else
    [[ "$CONFIRM_DEPLOY" = ROLLBACK_RUNTIME_ONLY ]] || { echo "Invalid rollback approval" >&2; exit 1; }
    [[ "${RUN_DB_MIGRATIONS:-no}" = no ]] || { echo "Rollback must never run migrations" >&2; exit 1; }
  fi
fi

# Require both cryptographic predicate types for the *exact OCI digests*
# signed by this repository's manual publishing workflow on main.
for ref in "$DEPLOY_RUNTIME_IMAGE" "$DEPLOY_MIGRATE_IMAGE"; do
  for predicate in https://slsa.dev/provenance/v1 https://spdx.dev/Document/v2.3; do
    gh attestation verify "oci://$ref" \
      --repo sauron9521/gym-api-nestjs \
      --signer-workflow sauron9521/gym-api-nestjs/.github/workflows/publish-ghcr.yml \
      --source-ref refs/heads/main \
      --source-digest "$PUBLISH_SHA" \
      --predicate-type "$predicate" >/dev/null
  done
  docker pull "$ref" >/dev/null
done
node scripts/production-digest-guard.mjs images

# An explicit expected current image prevents silently replacing an unknown
# manually deployed container, including a local-build instance.
current_id="$("${compose[@]}" ps --all -q api)"
current_image=none
if [[ -n "$current_id" ]]; then
  current_image="$(docker inspect --format '{{.Config.Image}}' "$current_id")"
fi
node scripts/production-digest-guard.mjs current "$current_image"

if [[ "$mode" = preflight ]]; then
  echo "All read-only preflight checks passed. No migrations or deployment performed."
  exit 0
fi

if [[ "$mode" = apply && "${RUN_DB_MIGRATIONS:-no}" = yes ]]; then
  # Forward-only Prisma migrations. The previous runtime remains running
  # until the one-shot operation succeeds. No automatic database rollback.
  "${compose[@]}" --profile ops run --rm --no-deps --pull never migrate
fi

# Keep all base Compose hardening, and explicitly forbid any local rebuild.
"${compose[@]}" up -d --no-deps --no-build --pull never --force-recreate api

container_id="$("${compose[@]}" ps -q api)"
[[ -n "$container_id" ]] || { echo "No API container after deploy" >&2; exit 1; }
running_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
[[ "$running_image" = "$DEPLOY_RUNTIME_IMAGE" ]] ||
  { echo "Running API image does not match approved digest" >&2; exit 1; }

ready=no
for _ in $(seq 1 40); do
  health="$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)"
  if [[ "$health" = healthy ]]; then ready=yes; break; fi
  [[ "$health" != unhealthy ]] || break
  sleep 3
done
if [[ "$ready" != yes ]]; then
  echo "API did not become healthy. Investigate and authorize manual runtime-only rollback." >&2
  exit 1
fi

printf 'Deployment finished: mode=%s source=%s runtime=%s\n' "$mode" "$SOURCE_SHA" "$DEPLOY_RUNTIME_IMAGE"
echo "Database migrations are never reversed automatically."
