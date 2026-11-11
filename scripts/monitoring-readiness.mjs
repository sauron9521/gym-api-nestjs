#!/usr/bin/env node
// Optional read-only production preflight. Never invoke Docker or access secrets.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const DEFAULT_LOG_FILE = '/var/log/gym-api/events.jsonl';
const DEFAULT_TEXTFILE_DIR = '/var/lib/node_exporter/textfile_collector';

// This is an operator readiness contract, not a replacement for Prometheus.
// Allow up to the existing alert threshold for the five-minute log monitor.
export const SOURCES = Object.freeze([
  { name: 'forwarder', timer: 'gym-api-forwarder.timer',
    filename: 'events.jsonl', maxAge: 150, metric: null },
  { name: 'monitor', timer: 'gym-api-monitor.timer',
    filename: 'gym_api_monitor.prom', maxAge: 900,
    metric: 'gym_api_monitor_last_run_timestamp_seconds' },
  { name: 'resources', timer: 'gym-api-resources.timer',
    filename: 'gym_api_docker.prom', maxAge: 180,
    metric: 'gym_api_docker_last_sample_timestamp_seconds' },
  { name: 'signals', timer: 'gym-api-signals.timer',
    filename: 'gym_api_docker_signals.prom', maxAge: 180,
    metric: 'gym_api_docker_signals_last_sample_timestamp_seconds' },
]);

export function parseArgs(args) {
  const options = { logFile: DEFAULT_LOG_FILE, textfileDir: DEFAULT_TEXTFILE_DIR };
  const keys = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if ((key !== '--log-file' && key !== '--textfile-dir') ||
        keys.has(key) || typeof value !== 'string' || !isAbsolute(value) ||
        value.includes('\0')) {
      throw new Error('Invalid preflight arguments');
    }
    keys.add(key);
    if (key === '--log-file') {
      if (basename(value) !== 'events.jsonl') throw new Error('Invalid log file');
      options.logFile = value;
    } else {
      options.textfileDir = value;
    }
  }
  return options;
}

export function parseTimestamp(text, metric) {
  if (typeof text !== 'string' || text.length > 64 * 1024) return null;
  const values = text.split('\n').filter(line =>
    line.startsWith(metric + ' '));
  if (values.length !== 1) return null;
  const match = new RegExp('^' + metric + ' ([0-9]+)$').exec(values[0].trimEnd());
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

async function probeSystemd(unit, state) {
  try {
    await execFileAsync('systemctl', [state, '--quiet', unit], {
      timeout: 3_000, maxBuffer: 4096,
    });
    return true;
  } catch {
    return false;
  }
}

function trustedDirectory(info) {
  return info.isDirectory() && !info.isSymbolicLink() &&
    (info.mode & 0o022) === 0;
}
function trustedFile(info, maxBytes) {
  return info.isFile() && !info.isSymbolicLink() &&
    (info.mode & 0o027) === 0 && info.size <= maxBytes;
}

/** No file content, paths, user-controlled strings or process errors are
 * returned. The output can be pasted safely into a support ticket.
 */
export async function assessReadiness({
  logFile = DEFAULT_LOG_FILE,
  textfileDir = DEFAULT_TEXTFILE_DIR,
  nowSeconds = Math.floor(Date.now() / 1000),
  probe = probeSystemd,
  stat = lstat,
  read = (path) => readFile(path, 'utf8'),
} = {}) {
  if (!isAbsolute(logFile) || basename(logFile) !== 'events.jsonl' ||
      !isAbsolute(textfileDir) || !Number.isSafeInteger(nowSeconds) ||
      nowSeconds < 0) {
    throw new Error('Invalid preflight configuration');
  }
  const items = [];
  for (const source of SOURCES) {
    const issues = [];
    const path = source.metric
      ? join(textfileDir, source.filename) : logFile;
    for (const state of ['is-active', 'is-enabled']) {
      let ok = false;
      try { ok = (await probe(source.timer, state)) === true; }
      catch { /* Fail closed without printing privileged errors. */ }
      if (!ok) issues.push(state === 'is-active'
        ? 'TIMER_INACTIVE' : 'TIMER_DISABLED');
    }
    try {
      const [folder, file] = await Promise.all([
        stat(dirname(path)), stat(path),
      ]);
      if (!trustedDirectory(folder)) issues.push('DIRECTORY_UNSAFE');
      if (!trustedFile(file, source.metric ? 128 * 1024 : 16 * 1024 * 1024)) issues.push('FILE_UNSAFE');
      if (issues.includes('DIRECTORY_UNSAFE') || issues.includes('FILE_UNSAFE')) {
        // Never read a file in an unsafe location.
        items.push({ component: source.name, issues });
        continue;
      }
      const modified = Math.floor(file.mtimeMs / 1000);
      if (modified > nowSeconds + 60) issues.push('FILE_CLOCK_SKEW');
      else if (nowSeconds - modified > source.maxAge) issues.push('FILE_STALE');

      if (source.metric) {
        const timestamp = parseTimestamp(await read(path), source.metric);
        if (timestamp === null) issues.push('METRIC_MALFORMED');
        else if (timestamp > nowSeconds + 60) issues.push('METRIC_CLOCK_SKEW');
        else if (nowSeconds - timestamp > source.maxAge) issues.push('METRIC_STALE');
      }
    } catch {
      issues.push('SOURCE_UNAVAILABLE');
    }
    items.push({ component: source.name, issues });
  }
  return { ready: items.every(item => item.issues.length === 0), items };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await assessReadiness(options);
    process.stdout.write(JSON.stringify(report) + '\n');
    if (!report.ready) process.exitCode = 1;
  } catch {
    process.stderr.write('Monitoring readiness preflight failed: invalid configuration\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
