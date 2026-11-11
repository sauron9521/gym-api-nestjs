#!/usr/bin/env bash
# Privileged TRUSTED forwarder. Gym monitor never calls Docker.
# Rebuild one last-10-minute sanitized JSONL snapshot every minute.
set -Eeuo pipefail
umask 027  # mktemp remains 0600; final JSONL is group-readable 0640

: "${FORWARD_CONTAINER:?Set an exact container name}"
: "${FORWARD_LOG_FILE:?Set absolute /var/log/gym-api/events.jsonl}"
if [[ ! "$FORWARD_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  printf '%s\n' 'Invalid forwarder container identifier' >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
filtered="$(mktemp)"
trap 'rm -f -- "$filtered"' EXIT

# Never write raw Docker logs to disk. Check the two producer statuses
# BEFORE publishing; even a partially successful pipeline fails closed.
set +e
# Docker writes container warnings/errors to stderr; include both streams.
# Docker CLI errors lack a timestamp and fail normalization instead of leaking.
docker logs --since 10m --timestamps -- "$FORWARD_CONTAINER" 2>&1 \
  | node "$script_dir/monitoring-docker-forwarder.mjs" normalize > "$filtered"
statuses=("${PIPESTATUS[@]}")
set -e

if [[ "${statuses[0]}" -ne 0 || "${statuses[1]}" -ne 0 ]]; then
  printf '%s\n' 'Trusted monitoring log source unavailable' >&2
  exit 1
fi

# Publication is atomic. A failed Docker log command, parse failure or
# filesystem error preserves the last complete snapshot and old mtime.
node "$script_dir/monitoring-docker-forwarder.mjs" \
  publish --output "$FORWARD_LOG_FILE" < "$filtered"
