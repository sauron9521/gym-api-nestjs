#!/usr/bin/env bash
# Disposable real Docker Engine restart-policy regression. Never touches the API.
set -Eeuo pipefail
: "${MONITOR_E2E_IMAGE:=gym-api:runtime-ci}"
name="gym-restart-e2e-$$-${RANDOM}"
workdir="$(mktemp -d)"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf -- "$workdir"
}
trap cleanup EXIT
printf '0' > "$workdir/attempt"
# The production image runs as non-root; this disposable fixture contains no secrets.
chmod 0777 "$workdir"
chmod 0666 "$workdir/attempt"
# The first invocation crashes; the next stays alive until the test stops it.
docker run -d --name "$name" --restart unless-stopped \
  --memory 1g --memory-swap 1g --cpus 2 --pids-limit 256 \
  --mount "type=bind,src=$workdir,dst=/state" \
  --entrypoint node "$MONITOR_E2E_IMAGE" -e '
    const fs = require("node:fs");
    const file = "/state/attempt";
    const attempt = Number(fs.readFileSync(file, "utf8")) + 1;
    fs.writeFileSync(file, String(attempt));
    if (attempt === 1) setTimeout(() => process.exit(23), 11000);
    setInterval(() => {}, 1000);
  ' >/dev/null
success=0
for i in $(seq 1 160); do
  state="$(docker inspect --format '{{.State.Running}} {{.RestartCount}}' "$name")"
  if [[ "$state" =~ ^true\ ([1-9][0-9]*)$ ]] && [[ "$(cat "$workdir/attempt")" -ge 2 ]]; then
    success=1
    break
  fi
  sleep 0.25
done
if [[ "$success" -ne 1 ]]; then
  echo 'Docker did not restart the failed disposable container' >&2
  exit 1
fi
[[ "$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$name")" = unless-stopped ]]
[[ "$(docker inspect --format '{{.HostConfig.Memory}}' "$name")" = 1073741824 ]]
[[ "$(docker inspect --format '{{.HostConfig.MemorySwap}}' "$name")" = 1073741824 ]]
[[ "$(docker inspect --format '{{.HostConfig.NanoCpus}}' "$name")" = 2000000000 ]]
[[ "$(docker inspect --format '{{.HostConfig.PidsLimit}}' "$name")" = 256 ]]
# Run the actual host-side sampler against the disposable live container.
# A private output directory models the trusted node_exporter textfile target.
mkdir -m 0700 "$workdir/metrics"
export RESOURCE_CONTAINER="$name"
export RESOURCE_TEXTFILE_PATH="$workdir/metrics/gym_api_docker.prom"
node scripts/monitoring-docker-resources.mjs
grep -Fxq 'gym_api_docker_running 1' "$RESOURCE_TEXTFILE_PATH"
grep -Eq '^gym_api_docker_restart_count [1-9][0-9]*
sleep 2
[[ "$(docker inspect --format '{{.State.Running}}' "$name")" = false ]] || {
  echo 'Explicit stop unexpectedly restarted the container' >&2
  exit 1
}
RESOURCE_CONTAINER="$name" node scripts/monitoring-docker-resources.mjs
grep -Fxq 'gym_api_docker_running 0' "$RESOURCE_TEXTFILE_PATH"
grep -Fxq 'gym_api_docker_memory_percent -1' "$RESOURCE_TEXTFILE_PATH"
echo 'Docker resource sampler live, unavailable, and stopped states: OK'
echo 'Docker restart policy and resource ceilings: OK'
 "$RESOURCE_TEXTFILE_PATH"
grep -Eq '^gym_api_docker_memory_percent [0-9]' "$RESOURCE_TEXTFILE_PATH"
[[ "$(stat -c '%a' "$RESOURCE_TEXTFILE_PATH")" = 640 ]]
cp "$RESOURCE_TEXTFILE_PATH" "$workdir/last-good.prom"
if RESOURCE_CONTAINER="missing-$name" node scripts/monitoring-docker-resources.mjs >/dev/null 2>&1; then
  echo 'Resource sampler accepted a missing Docker container' >&2
  exit 1
fi
cmp -s "$RESOURCE_TEXTFILE_PATH" "$workdir/last-good.prom" || {
  echo 'Failed Docker collection overwrote last good sample' >&2
  exit 1
}
docker stop --time 3 "$name" >/dev/null
sleep 2
[[ "$(docker inspect --format '{{.State.Running}}' "$name")" = false ]] || {
  echo 'Explicit stop unexpectedly restarted the container' >&2
  exit 1
}
echo 'Docker restart policy and resource ceilings: OK'
