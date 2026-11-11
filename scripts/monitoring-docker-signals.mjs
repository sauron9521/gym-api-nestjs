#!/usr/bin/env node
// Opt-in, trusted Docker host sampler. Never run inside gym-monitor or API.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const CONTAINER_ID = /^[a-f0-9]{64}$/;
const WINDOW_SECONDS = 600;
const OUTPUT_NAME = 'gym_api_docker_signals.prom';

export function parseIdentity(input) {
  const match = typeof input === 'string'
    ? /^([a-f0-9]{64}) (\d+) (true|false)$/.exec(input.trim()) : null;
  if (!match) throw new Error('Invalid Docker identity');
  const pid = Number(match[2]);
  if (!Number.isSafeInteger(pid) || (match[3] === 'true' && pid < 1) ||
      (match[3] === 'false' && pid !== 0)) {
    throw new Error('Invalid Docker PID');
  }
  return { id: match[1], pid, running: match[3] === 'true' };
}

export function parseOomEvents(text, id, since, until) {
  if (!CONTAINER_ID.test(id) || !Number.isSafeInteger(since) ||
      !Number.isSafeInteger(until) || since < 0 || until <= since ||
      until - since !== WINDOW_SECONDS || typeof text !== 'string' ||
      Buffer.byteLength(text) > 256 * 1024) {
    throw new Error('Invalid Docker event input');
  }
  if (!text.trim()) return 0;
  const lines = text.trimEnd().split('\n');
  if (lines.length > 512) throw new Error('Too many Docker events');
  let total = 0;
  for (const line of lines) {
    if (Buffer.byteLength(line) > 16 * 1024) throw new Error('Oversized Docker event');
    let event;
    try { event = JSON.parse(line); }
    catch { throw new Error('Invalid Docker event'); }
    if (!event || event.Type !== 'container' || event.Action !== 'oom' ||
        event.Actor?.ID !== id || !Number.isSafeInteger(event.time) ||
        event.time < since || event.time > until) {
      throw new Error('Unexpected Docker event');
    }
    // Nanosecond Docker timestamps exceed JS safe integers. Count each
    // emitted event record instead of coercing or deduplicating timeNano.
    total += 1;
  }
  return total;
}

export function cgroupCpuStatPath(cgroup, containerId) {
  if (typeof cgroup !== 'string' || cgroup.length > 4096 ||
      !CONTAINER_ID.test(containerId)) {
    throw new Error('Invalid cgroup mapping');
  }
  const lines = cgroup.trim().split(/\r?\n/);
  const values = lines.filter(line => line.startsWith('0::'));
  if (values.length !== 1) throw new Error('Requires host cgroup v2');
  const relative = values[0].slice(3);
  if (!relative.startsWith('/') || !relative.includes(containerId) ||
      relative.includes('\0') ||
      relative.split('/').some(part => part === '.' || part === '..') ||
      !/^\/[a-zA-Z0-9_./:-]*$/.test(relative)) {
    throw new Error('Invalid cgroup location');
  }
  const destination = resolve('/sys/fs/cgroup', '.' + relative, 'cpu.stat');
  if (!destination.startsWith('/sys/fs/cgroup/')) {
    throw new Error('Untrusted cgroup location');
  }
  return destination;
}

export function parseCpuStat(text) {
  if (typeof text !== 'string' || text.length > 8192) {
    throw new Error('Invalid cgroup CPU counters');
  }
  const values = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^([a-z][a-z0-9_.-]*)[ \t]+(\d+)$/.exec(line);
    if (!match || values.has(match[1])) throw new Error('Invalid cgroup CPU counters');
    values.set(match[1], Number(match[2]));
  }
  const required = ['nr_periods', 'nr_throttled', 'throttled_usec'];
  if (!required.every(k => Number.isSafeInteger(values.get(k))) ||
      values.get('nr_throttled') > values.get('nr_periods')) {
    throw new Error('Missing or invalid cgroup CPU counters');
  }
  return {
    periods: values.get('nr_periods'),
    throttledPeriods: values.get('nr_throttled'),
    throttledSeconds: values.get('throttled_usec') / 1e6,
  };
}

async function docker(args) {
  const { stdout } = await run('docker', args, { timeout: 15_000, maxBuffer: 256 * 1024 });
  return stdout;
}

export async function collectSignals(container, now = Math.floor(Date.now() / 1000),
  invoke = docker, read = (path) => readFile(path, 'utf8')) {
  if (typeof container !== 'string' || !CONTAINER_NAME.test(container) ||
      !Number.isSafeInteger(now) || now < WINDOW_SECONDS) {
    throw new Error('Invalid resource configuration');
  }
  const identity = parseIdentity(await invoke([
    'inspect', '--format', '{{.Id}} {{.State.Pid}} {{.State.Running}}', container,
  ]));
  const since = now - WINDOW_SECONDS;
  // Time-bounded Docker API query (not a permanent streaming connection).
  const events = await invoke([
    'events', '--since', String(since), '--until', String(now),
    '--filter', 'container=' + identity.id, '--filter', 'event=oom',
    '--format', '{{json .}}',
  ]);
  const oomEvents = parseOomEvents(events, identity.id, since, now);
  let cpu = null;
  if (identity.running) {
    const mapping = await read('/proc/' + identity.pid + '/cgroup');
    cpu = parseCpuStat(await read(cgroupCpuStatPath(mapping, identity.id)));
  }
  return { running: identity.running, oomEvents, cpu };
}

export function metricsFromSignals(sample, now = Math.floor(Date.now() / 1000)) {
  if (!sample || !Number.isSafeInteger(now) || now < 0 ||
      typeof sample.running !== 'boolean' ||
      !Number.isSafeInteger(sample.oomEvents) ||
      sample.oomEvents < 0 || sample.oomEvents > 512 ||
      (sample.running !== (sample.cpu !== null))) {
    throw new Error('Invalid Docker signals');
  }
  const values = [
    ['gym_api_docker_signals_last_sample_timestamp_seconds', now, 'gauge'],
    ['gym_api_docker_signals_running', Number(sample.running), 'gauge'],
    ['gym_api_docker_oom_events_window_10m', sample.oomEvents, 'gauge'],
  ];
  if (sample.running) {
    const c = sample.cpu;
    if (!c || !Number.isSafeInteger(c.periods) ||
        !Number.isSafeInteger(c.throttledPeriods) ||
        c.periods < 0 || c.throttledPeriods < 0 ||
        c.throttledPeriods > c.periods || !Number.isFinite(c.throttledSeconds) ||
        c.throttledSeconds < 0) {
      throw new Error('Invalid cgroup CPU sample');
    }
    values.push(
      ['gym_api_docker_cpu_periods_total', c.periods, 'counter'],
      ['gym_api_docker_cpu_throttled_periods_total', c.throttledPeriods, 'counter'],
      ['gym_api_docker_cpu_throttled_seconds_total', c.throttledSeconds, 'counter'],
    );
  }
  return values.map(([name, value, type]) =>
    '# TYPE ' + name + ' ' + type + '\n' + name + ' ' + value + '\n').join('');
}

export async function publishSignals(output, contents) {
  if (typeof output !== 'string' || !isAbsolute(output) ||
      basename(output) !== OUTPUT_NAME) {
    throw new Error('Invalid Docker signals destination');
  }
  const parent = dirname(output);
  const info = await lstat(parent);
  if (!info.isDirectory() || (info.mode & 0o022) !== 0) {
    throw new Error('Unsafe Docker signals directory');
  }
  try {
    const old = await lstat(output);
    if (!old.isFile() || old.isSymbolicLink()) {
      throw new Error('Unsafe Docker signals file');
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  const temp = join(parent, '.' + OUTPUT_NAME + '.' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await open(temp, 'wx', 0o640);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, output);
  } catch {
    await handle?.close().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
    throw new Error('Docker signals publication failed');
  }
}

async function main() {
  try {
    const sample = await collectSignals(process.env.SIGNALS_CONTAINER);
    await publishSignals(process.env.SIGNALS_TEXTFILE_PATH, metricsFromSignals(sample));
  } catch {
    // Never expose raw Docker, cgroup paths, or possibly private CLI errors.
    process.stderr.write('Docker signals monitoring failed\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
