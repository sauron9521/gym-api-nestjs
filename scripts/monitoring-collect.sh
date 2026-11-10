#!/usr/bin/env bash
# One-shot, five-minute report for node_exporter's textfile collector.
# Does NOT install a timer, expose an endpoint, or send notifications.
set -Eeuo pipefail
umask 027

: "${API_CONTAINER:?Set API_CONTAINER to the exact Docker container name}"
: "${MONITOR_API_ORIGIN:?Set MONITOR_API_ORIGIN to an HTTP(S) origin}"
: "${MONITOR_TEXTFILE_PATH:?Set MONITOR_TEXTFILE_PATH to an absolute .prom file}"

# Never let a caller provide Docker flags in place of a container name.
if [[ ! "${API_CONTAINER}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  printf '%s\n' 'Invalid monitor container identifier' >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
report_file="$(mktemp)"
trap 'rm -f -- "$report_file"' EXIT

# Capture the status of *both* producer and consumer; a failed Docker
# command must not publish 0 requests as if a complete window were read.
set +e
docker logs --since 5m -- "$API_CONTAINER" 2>/dev/null \
  | node "$script_dir/monitoring-report.mjs" --base-url "$MONITOR_API_ORIGIN" > "$report_file"
statuses=("${PIPESTATUS[@]}")
set -e

if [[ "${statuses[0]}" -ne 0 ]]; then
  printf '%s\n' 'Monitoring log collection failed' >&2
  exit 1
fi
if [[ "${statuses[1]}" -ne 0 && "${statuses[1]}" -ne 2 ]]; then
  printf '%s\n' 'Monitoring report failed' >&2
  exit 1
fi

# Write only sanitized gauges and an up-to-date run timestamp.
# Atomic rename preserves the last good report on collection failure.
node "$script_dir/monitoring-textfile.mjs" --output "$MONITOR_TEXTFILE_PATH" < "$report_file"

# 2 signals critical metrics to non-systemd callers; the sample systemd
# unit treats 2 as a successful *publication*, letting Prometheus alert.
exit "${statuses[1]}"
