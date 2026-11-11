#!/usr/bin/env bash
# One-shot five-minute report from an already-provisioned read-only log file.
# No Docker socket, process privileges, background scheduling or notifications.
set -Eeuo pipefail
umask 027

: "${MONITOR_LOG_FILE:?Set MONITOR_LOG_FILE to an absolute read-only .jsonl source}"
: "${MONITOR_API_ORIGIN:?Set MONITOR_API_ORIGIN to an HTTP(S) origin}"
: "${MONITOR_TEXTFILE_PATH:?Set MONITOR_TEXTFILE_PATH to an absolute .prom file}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
report_file="$(mktemp)"
trap 'rm -f -- "$report_file"' EXIT

# Both pipeline commands must succeed (report exit 2 means critical health
# signal, NOT an invalid report). An invalid source leaves the old .prom
# snapshot untouched so its existing stale timestamp can trigger an alert.
set +e
node "$script_dir/monitoring-log-window.mjs" --file "$MONITOR_LOG_FILE" \
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

node "$script_dir/monitoring-textfile.mjs" --output "$MONITOR_TEXTFILE_PATH" < "$report_file"
exit "${statuses[1]}"
