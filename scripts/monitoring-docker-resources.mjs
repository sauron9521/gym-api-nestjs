#!/usr/bin/env node
// Trusted host-side Docker sampler. Never execute inside gym-monitor.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const DESTINATION = 'gym_api_docker.prom';
const CONTAINER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export function parseInspect(text) {
  if (typeof text !== 'string') throw new Error('Invalid inspect response');
  const match = /^(\d+) (true|false) (true|false)$/.exec(text.trim());
  if (!match) throw new Error('Invalid inspect response');
  const restarts = Number(match[1]);
  if (!Number.isSafeInteger(restarts)) throw new Error('Invalid restart count');
  return {
    restartCount: restarts,
    oomKilled: match[2] === 'true',
    running: match[3] === 'true',
  };
}

function percent(value, maximum) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?%$/.test(value)) {
    throw new Error('Invalid resource percentage');
  }
  const numeric = Number(value.slice(0, -1));
  if (!Number.isFinite(numeric) || numeric > maximum) {
    throw new Error('Out of range resource percentage');
  }
  return numeric;
}

export function parseStats(text) {
  if (typeof text !== 'string') throw new Error('Invalid stats response');
  const lines = text.trim().split(/\r?\n/);
  if (lines.length !== 1 || lines[0].length > 16_384) {
    throw new Error('Invalid stats response');
  }
  let stats;
  try { stats = JSON.parse(lines[0]); }
  catch { throw new Error('Invalid stats JSON'); }
  if (!stats || typeof stats !== 'object' || Array.isArray(stats) ||
      typeof stats.PIDs !== 'string' || !/^\d+$/.test(stats.PIDs)) {
    throw new Error('Invalid stats fields');
  }
  const pids = Number(stats.PIDs);
  if (!Number.isSafeInteger(pids)) throw new Error('Invalid PID count');
  return {
    cpuPercent: percent(stats.CPUPerc, 100_000),
    memoryPercent: percent(stats.MemPerc, 100),
    pids,
  };
}

export async function collectSample(container, invoke = invokeDocker) {
  if (typeof container !== 'string' || !CONTAINER_PATTERN.test(container)) {
    throw new Error('Invalid container');
  }
  // Only request fixed numeric fields: never read inspect env, labels or secrets.
  const status = parseInspect(await invoke([
    'inspect', '--format',
    '{{.RestartCount}} {{.State.OOMKilled}} {{.State.Running}}', container,
  ]));
  // Preserve OOM/stopped state while marking unavailable usage as -1, not 0.
  const usage = status.running ? parseStats(await invoke([
    'stats', '--no-stream', '--format', '{{json .}}', container,
  ])) : { cpuPercent: -1, memoryPercent: -1, pids: -1 };
  return { ...status, ...usage };
}

async function invokeDocker(args) {
  const { stdout } = await execFileAsync('docker', args, {
    timeout: 12_000, maxBuffer: 64 * 1024,
  });
  return stdout;
}

export function metricsFromSample(sample, now = Math.floor(Date.now() / 1000)) {
  if (!sample || !Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(sample.restartCount) || sample.restartCount < 0 ||
      typeof sample.running !== 'boolean' ||
      typeof sample.oomKilled !== 'boolean' ||
      ![sample.cpuPercent, sample.memoryPercent, sample.pids].every(Number.isFinite) ||
      sample.cpuPercent < -1 || sample.cpuPercent > 100_000 ||
      sample.memoryPercent < -1 || sample.memoryPercent > 100 ||
      sample.pids < -1 || !Number.isSafeInteger(sample.pids) ||
      (sample.running && (sample.cpuPercent < 0 || sample.memoryPercent < 0 ||
        sample.pids < 0)) ||
      (!sample.running && (sample.cpuPercent !== -1 ||
        sample.memoryPercent !== -1 || sample.pids !== -1))) {
    throw new Error('Invalid resource sample');
  }
  const values = [
    ['gym_api_docker_last_sample_timestamp_seconds', now],
    ['gym_api_docker_running', Number(sample.running)],
    ['gym_api_docker_cpu_percent', sample.cpuPercent],
    ['gym_api_docker_memory_percent', sample.memoryPercent],
    ['gym_api_docker_pids', sample.pids],
    ['gym_api_docker_restart_count', sample.restartCount],
    ['gym_api_docker_oom_killed', Number(sample.oomKilled)],
  ];
  // No labels, hostnames, paths, container names or Docker inspection text.
  return values.map(([key, value]) =>
    '# TYPE ' + key + ' gauge\n' + key + ' ' + value + '\n').join('');
}

export async function publishMetrics(path, text) {
  if (typeof path !== 'string' || !isAbsolute(path) ||
      basename(path) !== DESTINATION) {
    throw new Error('Invalid metrics path');
  }
  const parent = dirname(path);
  const dir = await lstat(parent);
  if (!dir.isDirectory() || (dir.mode & 0o022) !== 0) {
    throw new Error('Unsafe metrics directory');
  }
  try {
    const old = await lstat(path);
    if (!old.isFile() || old.isSymbolicLink()) {
      throw new Error('Unsafe metrics destination');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const tmp = join(parent, '.' + DESTINATION + '.' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await open(tmp, 'wx', 0o640);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tmp, path);
  } catch {
    await handle?.close().catch(() => undefined);
    await unlink(tmp).catch(() => undefined);
    throw new Error('Metrics publication failed');
  }
}

async function main() {
  try {
    const container = process.env.RESOURCE_CONTAINER;
    const output = process.env.RESOURCE_TEXTFILE_PATH;
    const sample = await collectSample(container);
    await publishMetrics(output, metricsFromSample(sample));
  } catch {
    // A Docker CLI error can contain private host data; never print it.
    process.stderr.write('Docker resource monitoring failed\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
