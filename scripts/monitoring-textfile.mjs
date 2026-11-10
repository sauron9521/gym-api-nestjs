#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CRITICAL_CODES = new Set([
  'HIGH_HTTP_503_RATE',
  'LIVENESS_PROBE_FAILED',
  'READINESS_PROBE_FAILED',
]);
const WARNING_CODES = new Set(['HIGH_HTTP_429_RATE', 'REDIS_OUTAGE_OBSERVED']);
const MAX_INPUT_BYTES = 128 * 1024;

function isCounter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validProbe(value) {
  return value && ['ok', 'failed', 'not_checked'].includes(value.status);
}

export function metricsFromReport(report, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!report || report.source !== 'application_log_batch' ||
      !report.counters || !report.probes || !Array.isArray(report.alerts) ||
      !isCounter(nowSeconds)) {
    throw new Error('Invalid report');
  }

  const counts = report.counters;
  const keys = ['httpRequests', 'http429', 'http503', 'redisOutages',
    'redisRecoveries', 'ignoredLines'];
  if (!keys.every((key) => isCounter(counts[key])) ||
      counts.http429 + counts.http503 > counts.httpRequests ||
      !validProbe(report.probes.live) || !validProbe(report.probes.ready) ||
      !report.alerts.every((alert) =>
        alert && ['critical', 'warning'].includes(alert.severity) &&
        (CRITICAL_CODES.has(alert.code) || WARNING_CODES.has(alert.code)))) {
    throw new Error('Invalid report');
  }

  const probeValue = (probe) => probe.status === 'ok' ? 1 :
    probe.status === 'failed' ? 0 : -1;
  const hasAlert = (severity) => Number(report.alerts.some(
    (alert) => alert.severity === severity,
  ));

  // Each metric has a fixed name and no labels: no IPs, user IDs, URLs,
  // secrets, exception text or high-cardinality values can be exported.
  const values = [
    ['gym_api_monitor_last_run_timestamp_seconds', nowSeconds,
      'Timestamp of last successfully published monitoring report'],
    ['gym_api_monitor_http_requests_window_5m', counts.httpRequests,
      'Number of requests from supplied 5-minute log window'],
    ['gym_api_monitor_http_429_window_5m', counts.http429,
      'HTTP 429 responses from supplied 5-minute log window'],
    ['gym_api_monitor_http_503_window_5m', counts.http503,
      'HTTP 503 responses from supplied 5-minute log window'],
    ['gym_api_monitor_redis_outages_window_5m', counts.redisOutages,
      'Redis unavailable transitions in supplied 5-minute log window'],
    ['gym_api_monitor_redis_recoveries_window_5m', counts.redisRecoveries,
      'Redis recovery transitions in supplied 5-minute log window'],
    ['gym_api_monitor_ignored_log_lines_window_5m', counts.ignoredLines,
      'Unrecognized log lines in supplied 5-minute window'],
    ['gym_api_monitor_live_probe_success', probeValue(report.probes.live),
      'Liveness 1 healthy, 0 failed, minus 1 not checked'],
    ['gym_api_monitor_ready_probe_success', probeValue(report.probes.ready),
      'Readiness 1 healthy, 0 failed, minus 1 not checked'],
    ['gym_api_monitor_critical_alert', hasAlert('critical'),
      'One if the report contains at least one critical alert'],
    ['gym_api_monitor_warning_alert', hasAlert('warning'),
      'One if the report contains at least one warning alert'],
  ];

  return values.map(([name, value, help]) =>
    '# HELP ' + name + ' ' + help + '\n' +
    '# TYPE ' + name + ' gauge\n' +
    name + ' ' + String(value) + '\n',
  ).join('');
}

/** The output directory must exist and be writable by the operator.
 * Atomic rename keeps node_exporter from ever reading half a report.
 */
export async function writeMetricsFile(outputPath, text) {
  if (typeof outputPath !== 'string' || !isAbsolute(outputPath) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.prom$/.test(basename(outputPath))) {
    throw new Error('Invalid metrics destination');
  }
  const tmpPath = join(dirname(outputPath), '.' + basename(outputPath) +
    '.' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await open(tmpPath, 'wx', 0o600);
    await handle.writeFile(text, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tmpPath, outputPath);
  } catch {
    await handle?.close().catch(() => undefined);
    await unlink(tmpPath).catch(() => undefined);
    throw new Error('Unable to publish monitoring metrics');
  }
}

export function parseOutputArg(args) {
  if (args.length !== 2 || args[0] !== '--output' ||
      !isAbsolute(args[1] ?? '') ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.prom$/.test(basename(args[1] ?? ''))) {
    throw new Error('Expected absolute --output path');
  }
  return args[1];
}

async function main() {
  try {
    const outputPath = parseOutputArg(process.argv.slice(2));
    const chunks = [];
    let total = 0;
    for await (const chunk of process.stdin) {
      total += chunk.length;
      if (total > MAX_INPUT_BYTES) throw new Error('Report too large');
      chunks.push(chunk);
    }
    const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const text = metricsFromReport(report);
    await writeMetricsFile(outputPath, text);
  } catch {
    // Never echo a potentially credential-bearing path or untrusted JSON.
    process.stderr.write('Monitoring metrics publication failed\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
