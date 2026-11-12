#!/usr/bin/env bash
# Disposable GitHub-runner only. This script has no remote host/production path.
set -euo pipefail
mode="${1:-}"
node scripts/staging-upgrade-rollback.mjs identity >/dev/null
: "${STAGING_API:?Missing isolated runner API name}"
: "${STAGING_NETWORK:?Missing isolated runner network}"
: "${STAGING_AVATARS:?Missing isolated runner volume}"
: "${STAGING_DATABASE_URL:?Missing disposable test database}"
: "${STAGING_REDIS_URL:?Missing disposable test Redis}"
: "${RUNNER_TEMP:?Missing GitHub runner temporary directory}"
[[ "${GITHUB_ACTIONS:-}" = true && "$STAGING_API" == gym-upgrade-api-* ]] ||
  { echo "This script is for isolated GitHub Actions staging only" >&2; exit 1; }
[[ -s "$RUNNER_TEMP/staging-upgrade-jwt" ]] ||
  { echo "Missing ephemeral staging-only JWT secret" >&2; exit 1; }
case "$mode" in
  start-previous)
    target="$PREVIOUS_RUNTIME_IMAGE"
    if docker inspect "$STAGING_API" >/dev/null 2>&1; then
      echo "Unexpected running container before initial staging boot" >&2
      exit 1
    fi
    phase=previous
    ;;
  switch-target)
    target="$TARGET_RUNTIME_IMAGE"
    expected="$PREVIOUS_RUNTIME_IMAGE"
    phase=target
    ;;
  rollback-previous)
    target="$PREVIOUS_RUNTIME_IMAGE"
    expected="$TARGET_RUNTIME_IMAGE"
    phase=previous
    ;;
  *)
    echo "Unknown isolated staging transition" >&2
    exit 1
    ;;
esac

if [[ "$mode" != start-previous ]]; then
  current="$(docker inspect --format '{{.Config.Image}}' "$STAGING_API")"
  [[ "$current" = "$expected" ]] ||
    { echo "Current runner-only image did not match approved previous phase" >&2; exit 1; }
  # Runtime-only replacement: no database schema downgrade and no reset.
  docker stop --time 25 "$STAGING_API" >/dev/null
  docker rm -v "$STAGING_API" >/dev/null
fi

docker run --pull never -d --name "$STAGING_API" --init \
  --network "$STAGING_NETWORK" -p 127.0.0.1:31848:3000 \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 1g --memory-swap 1g --cpus 2 --pids-limit 256 \
  --mount "type=volume,src=$STAGING_AVATARS,dst=/app/uploads/avatars" \
  -e DATABASE_URL="$STAGING_DATABASE_URL" \
  -e REDIS_URL="$STAGING_REDIS_URL" \
  -e NODE_ENV=production -e PORT=3000 \
  -e JWT_SECRET="$(cat "$RUNNER_TEMP/staging-upgrade-jwt")" \
  -e JWT_ISSUER=https://api.example.test \
  -e APP_URL=https://app.example.test \
  -e CORS_ORIGINS=https://app.example.test \
  -e SMTP_URL=smtps://127.0.0.1:4465 \
  -e MAIL_FROM="Gym Staging <no-reply@example.test>" \
  -e ENABLE_OPENAPI=false "$target" >/dev/null

healthy=no
for _ in $(seq 1 55); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$STAGING_API" 2>/dev/null || true)"
  if [[ "$status" = healthy ]]; then
    healthy=yes
    break
  fi
  [[ "$(docker inspect --format '{{.State.Running}}' "$STAGING_API" 2>/dev/null || true)" = true ]] || break
  sleep 2
done
[[ "$healthy" = yes ]] ||
  { echo "Isolated staging API did not recover a healthy Docker status" >&2; exit 1; }
[[ "$(docker inspect --format '{{.Config.Image}}' "$STAGING_API")" = "$target" ]] ||
  { echo "Isolated running image differs from approved digest" >&2; exit 1; }
node scripts/staging-upgrade-rollback.mjs probe "$phase"
printf 'Isolated staging runtime phase %s became healthy at expected digest.\n' "$phase"
