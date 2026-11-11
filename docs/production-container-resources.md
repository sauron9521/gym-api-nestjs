# Production API container resource limits and recovery (PR #132)

The production Compose API service has explicit ceilings: **1 GiB RAM**, **1 GiB total memory+swap**, **2 CPUs**, and **256 PIDs**. Docker's `unless-stopped` restart policy remains enabled. These are initial operational defaults, not capacity measurements or guaranteed performance targets. The one-shot migration job is intentionally unchanged.

## Deploy safely

Before rollout, measure peak RSS, CPU, request latency, event-loop delay, and concurrent connections under representative load. Adjust limits for the host and workload; 1 GiB may be insufficient for some deployments. Review `docker compose -f compose.prod.yml config` with the required production environment variables available, then recreate the API container during a maintenance window to apply HostConfig changes. Do not use `docker restart` alone to apply new limits.

```sh
docker compose -f compose.prod.yml --env-file .env.production config --quiet
docker compose -f compose.prod.yml --env-file .env.production up -d --no-deps --force-recreate api
docker inspect --format '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}} {{.HostConfig.RestartPolicy.Name}}' gym-api-api-1
docker stats --no-stream
```

The actual container name can differ; determine it using `docker compose -f compose.prod.yml ps -q api`. Never print a production Compose config into public CI logs because it can include secrets.

## Recovery and failure modes

The CI test `scripts/test-docker-resource-recovery.sh` uses a **disposable Node emitter**, not the actual API. It verifies a crash triggers Docker restart, resource ceilings are enforced in HostConfig, and an explicit stop remains stopped. It does **not** simulate kernel OOM, real application load, host reboot, Redis failure or database recovery.

- A process exit can trigger `unless-stopped` restart; a manually stopped container stays stopped until explicitly started or the daemon restarts according to Docker semantics.
- Memory exhaustion can result in an OOM kill; inspect `docker inspect --format '{{.State.OOMKilled}} {{.RestartCount}}' <container>` and Docker daemon logs before increasing limits.
- CPU throttling can increase request latency without killing the container. Use container metrics, p95/p99 latency, and 429/503 monitoring alerts together.
- A restart does not guarantee readiness. Check `/health/live`, `/health/ready`, and Prometheus snapshot freshness after recovery.
- Repeated restarts can cause downtime or load spikes. Escalate persistent failures rather than relying on the restart policy as a remediation strategy.

## Rollback

Restore the prior resource values in `compose.prod.yml`, validate configuration, and recreate the API container during an approved maintenance window. The PR makes no database migrations or persistent volume changes. Preserve the read-only filesystem, restricted privileges, log rotation and trusted monitoring separation.
