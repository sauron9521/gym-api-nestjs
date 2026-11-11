#!/usr/bin/env bash
# Disposable Docker Engine integration: real Docker Events and host cgroup v2.
set -Eeuo pipefail
: "${MONITOR_E2E_IMAGE:=gym-api:runtime-ci}"
docker info >/dev/null
container="gym-signals-e2e-$$-${RANDOM}"
workdir="$(mktemp -d)"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf -- "$workdir"
}
trap cleanup EXIT

docker run -d --name "$container" --memory 1g --memory-swap 1g \
  --cpus 2 --pids-limit 256 --entrypoint node \
  "$MONITOR_E2E_IMAGE" -e 'setInterval(() => {}, 1000)' >/dev/null

export SIGNALS_CONTAINER="$container"
export SIGNALS_TEXTFILE_PATH="$workdir/gym_api_docker_signals.prom"
node scripts/monitoring-docker-signals.mjs
grep -Fxq 'gym_api_docker_signals_running 1' "$SIGNALS_TEXTFILE_PATH"
grep -Fxq 'gym_api_docker_oom_events_window_10m 0' "$SIGNALS_TEXTFILE_PATH"
grep -Eq '^gym_api_docker_cpu_periods_total [0-9]+$' "$SIGNALS_TEXTFILE_PATH"
grep -Eq '^gym_api_docker_cpu_throttled_periods_total [0-9]+$' "$SIGNALS_TEXTFILE_PATH"
grep -Eq '^gym_api_docker_cpu_throttled_seconds_total [0-9]+(\.[0-9]+)?$' "$SIGNALS_TEXTFILE_PATH"
[[ "$(stat -c '%a' "$SIGNALS_TEXTFILE_PATH")" = 640 ]]
cp "$SIGNALS_TEXTFILE_PATH" "$workdir/previous.prom"

if SIGNALS_CONTAINER="missing-$container" node scripts/monitoring-docker-signals.mjs >/dev/null 2>&1; then
  echo 'Docker signal collector accepted missing container' >&2
  exit 1
fi
cmp -s "$SIGNALS_TEXTFILE_PATH" "$workdir/previous.prom" || {
  echo 'Missing container overwrote a valid Docker signal sample' >&2
  exit 1
}

docker stop --time 3 "$container" >/dev/null
node scripts/monitoring-docker-signals.mjs
grep -Fxq 'gym_api_docker_signals_running 0' "$SIGNALS_TEXTFILE_PATH"
grep -Fxq 'gym_api_docker_oom_events_window_10m 0' "$SIGNALS_TEXTFILE_PATH"
if grep -q '^gym_api_docker_cpu_periods_total ' "$SIGNALS_TEXTFILE_PATH"; then
  echo 'Stopped container published fictitious CPU counters' >&2
  exit 1
fi
echo 'Real Docker Events and cgroup v2 signals: OK'
