#!/usr/bin/env bash
# Genuine Docker Engine -> local logging -> trusted JSONL forwarder ->
# unprivileged monitoring reader -> Prometheus .prom integration regression.
set -Eeuo pipefail
umask 077
: "${MONITOR_E2E_IMAGE:=gym-api:runtime-ci}"
docker info >/dev/null
workdir="$(mktemp -d)"
container="gym-monitor-e2e-$$-${RANDOM}"
probe_pid=""
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  if [[ -n "$probe_pid" ]]; then
    kill "$probe_pid" >/dev/null 2>&1 || true
    wait "$probe_pid" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$workdir"
}
trap cleanup EXIT

# A real localhost HTTP server supplies healthy liveness/readiness probes.
node -e '
  const { createServer } = require("node:http");
  const { writeFileSync } = require("node:fs");
  createServer((req, res) => {
    if (!["/health/live", "/health/ready"].includes(req.url)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200).end(JSON.stringify({ status: "ok" }));
  }).listen(0, "127.0.0.1", function () {
    writeFileSync(process.argv[1], String(this.address().port));
  });
' "$workdir/health-port" >/dev/null 2>&1 &
probe_pid=$!
for attempt in $(seq 1 80); do
  [[ -s "$workdir/health-port" ]] && break
  kill -0 "$probe_pid" >/dev/null 2>&1 || {
    echo 'Monitoring E2E test health server exited' >&2
    exit 1
  }
  sleep 0.1
done
[[ -s "$workdir/health-port" ]] || exit 1

export FORWARD_CONTAINER="$container"
export FORWARD_LOG_FILE="$workdir/events.jsonl"
export MONITOR_LOG_FILE="$FORWARD_LOG_FILE"
export MONITOR_TEXTFILE_PATH="$workdir/gym_api_monitor.prom"
export MONITOR_API_ORIGIN="http://127.0.0.1:$(cat "$workdir/health-port")"

start_emitter() {
  docker run -d --name "$container" \
    --log-driver local --log-opt max-size=1m --log-opt max-file=2 \
    --entrypoint node "$MONITOR_E2E_IMAGE" -e '
      const phase = process.argv[1];
      const token = "SENSITIVE-MONITOR-E2E-TOKEN";
      const mail = "private-monitor-e2e@example.test";
      const http = (statusCode) => console.log(JSON.stringify({
        level: "log", message: "HTTP request completed",
        context: { event: "http.request.completed", statusCode,
          token, email: mail, path: "/private/" + token },
      }));
      if (phase === "initial") {
        for (let i = 0; i < 20; i++) http(429);
        for (let i = 0; i < 2; i++) http(503);
        console.error(JSON.stringify({ level: "warn", message: {
          event: "RATE_LIMIT_REDIS_UNAVAILABLE",
          redisUrl: "redis://:private@internal", token } }));
        console.error(JSON.stringify({ level: "log", message: {
          event: "RATE_LIMIT_REDIS_RECOVERED", email: mail } }));
      } else if (phase === "corrupt") {
        console.log("{corrupt-structured-json");
      } else if (phase === "recovered") {
        for (let i = 0; i < 6; i++) http(200);
        http(429);
        console.error(JSON.stringify({ message: {
          event: "RATE_LIMIT_REDIS_RECOVERED", token } }));
      } else process.exitCode = 2;
    ' "$1" >/dev/null
  [[ "$(docker wait "$container")" = 0 ]] || {
    echo 'Monitoring E2E Docker emitter failed' >&2
    exit 1
  }
  [[ "$(docker inspect --format '{{.HostConfig.LogConfig.Type}}' "$container")" = local ]] || {
    echo 'Monitoring E2E did not use Docker local logging driver' >&2
    exit 1
  }
}
remove_emitter() { docker rm -f "$container" >/dev/null; }
metric() {
  grep -Fxq "$1 $2" "$MONITOR_TEXTFILE_PATH" || {
    echo "Unexpected monitoring E2E metric: $1" >&2
    exit 1
  }
}
safe_outputs() {
  if grep -Eq 'private-monitor-e2e@example\.test|SENSITIVE-MONITOR-E2E-TOKEN|redis://:private@internal' "$FORWARD_LOG_FILE" "$MONITOR_TEXTFILE_PATH"; then
    echo 'Monitoring E2E private data leaked into sanitized files' >&2
    exit 1
  fi
  if grep -Eq '^gym_api_monitor_[^ ]+\{' "$MONITOR_TEXTFILE_PATH"; then
    echo 'Monitoring E2E unexpectedly exported labeled data' >&2
    exit 1
  fi
}
report_status() {
  local actual=0
  bash scripts/monitoring-collect.sh >/dev/null 2>&1 || actual=$?
  [[ "$actual" -eq "$1" ]] || {
    echo "Unexpected monitoring E2E report exit: $actual" >&2
    exit 1
  }
}

# Live end-to-end Docker stdout/stderr -> JSONL -> .prom + healthy probes.
start_emitter initial
bash scripts/monitoring-forward.sh >/dev/null
[[ -s "$FORWARD_LOG_FILE" && "$(stat -c '%a' "$FORWARD_LOG_FILE")" = 640 ]] || exit 1
report_status 2
metric gym_api_monitor_http_requests_window_5m 22
metric gym_api_monitor_http_429_window_5m 20
metric gym_api_monitor_http_503_window_5m 2
metric gym_api_monitor_redis_outages_window_5m 1
metric gym_api_monitor_redis_recoveries_window_5m 1
metric gym_api_monitor_live_probe_success 1
metric gym_api_monitor_ready_probe_success 1
metric gym_api_monitor_critical_alert 1
metric gym_api_monitor_warning_alert 1
safe_outputs

cp "$FORWARD_LOG_FILE" "$workdir/previous.jsonl"
cp "$MONITOR_TEXTFILE_PATH" "$workdir/previous.prom"

# Missing Docker container and malformed structured logs cannot overwrite
# the last successfully published snapshot.
remove_emitter
if bash scripts/monitoring-forward.sh >/dev/null 2>&1; then
  echo 'Forwarder accepted an absent Docker container' >&2
  exit 1
fi
cmp -s "$FORWARD_LOG_FILE" "$workdir/previous.jsonl" || exit 1

start_emitter corrupt
if bash scripts/monitoring-forward.sh >/dev/null 2>&1; then
  echo 'Forwarder accepted malformed Docker stdout' >&2
  exit 1
fi
cmp -s "$FORWARD_LOG_FILE" "$workdir/previous.jsonl" || exit 1

# A stopped forwarder yields stale JSONL. Monitoring must not advance
# the previous Prometheus timestamp or claim zero errors.
touch -d '5 minutes ago' "$FORWARD_LOG_FILE"
report_status 1
cmp -s "$MONITOR_TEXTFILE_PATH" "$workdir/previous.prom" || exit 1

# Recovery replaces both snapshots with valid data from a fresh container.
remove_emitter
start_emitter recovered
bash scripts/monitoring-forward.sh >/dev/null
report_status 0
metric gym_api_monitor_http_requests_window_5m 7
metric gym_api_monitor_http_429_window_5m 1
metric gym_api_monitor_http_503_window_5m 0
metric gym_api_monitor_redis_outages_window_5m 0
metric gym_api_monitor_redis_recoveries_window_5m 1
metric gym_api_monitor_critical_alert 0
metric gym_api_monitor_warning_alert 0
safe_outputs

echo 'Docker local logging -> sanitized JSONL -> Prometheus gauges: OK'
