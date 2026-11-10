#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const MAX_LOG_LINE_LENGTH = 64 * 1024;
const REDIS_OUTAGE = 'RATE_LIMIT_REDIS_UNAVAILABLE';
const REDIS_RECOVERY = 'RATE_LIMIT_REDIS_RECOVERED';
const HTTP_COMPLETED = 'http.request.completed';

/**
 * Deliberately aggregate only low-cardinality known events. Never store or
 * print raw logs, URLs, IPs, identities, route parameters or exception text.
 */
export function emptySummary() {
  return {
    httpRequests: 0,
    http429: 0,
    http503: 0,
    redisOutages: 0,
    redisRecoveries: 0,
    ignoredLines: 0,
  };
}

function object(value) {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) ? value : null;
}

function findEvent(record) {
  const root = object(record);
  if (!root) return null;

  // Support flattened structured logs and Nest JSON logger metadata. Logs
  // shipped through a collector can place the event in message/context.
  const candidates = [
    root,
    root.message,
    root.context,
    root.metadata,
    root.data,
    object(root.message)?.context,
    object(root.message)?.metadata,
  ];
  for (const candidate of candidates) {
    const item = object(candidate);
    if (item && typeof item.event === 'string') return item;
  }
  return null;
}

export function addLogLine(summary, line) {
  if (typeof line !== 'string' || line.length > MAX_LOG_LINE_LENGTH) {
    summary.ignoredLines += 1;
    return;
  }
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    summary.ignoredLines += 1;
    return;
  }
  const data = findEvent(record);
  if (!data) {
    summary.ignoredLines += 1;
    return;
  }
  if (data.event === HTTP_COMPLETED &&
      Number.isInteger(data.statusCode) &&
      data.statusCode >= 100 && data.statusCode <= 599) {
    summary.httpRequests += 1;
    if (data.statusCode === 429) summary.http429 += 1;
    if (data.statusCode === 503) summary.http503 += 1;
    return;
  }
  if (data.event === REDIS_OUTAGE) {
    summary.redisOutages += 1;
    return;
  }
  if (data.event === REDIS_RECOVERY) {
    summary.redisRecoveries += 1;
    return;
  }
  summary.ignoredLines += 1;
}

function safePercent(numerator, denominator) {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 100;
}

export function buildReport(summary, health = null) {
  const http429Percent = safePercent(summary.http429, summary.httpRequests);
  const http503Percent = safePercent(summary.http503, summary.httpRequests);
  const alerts = [];

  // Alert thresholds are initial recommendations for an already filtered,
  // time-bounded input window. No alarm is inferred from missing log lines.
  if (summary.httpRequests >= 20 && http429Percent >= 20) {
    alerts.push({ severity: 'warning', code: 'HIGH_HTTP_429_RATE' });
  }
  if (summary.httpRequests >= 20 && http503Percent >= 5) {
    alerts.push({ severity: 'critical', code: 'HIGH_HTTP_503_RATE' });
  }
  if (summary.redisOutages > 0) {
    alerts.push({ severity: 'warning', code: 'REDIS_OUTAGE_OBSERVED' });
  }
  if (health?.live?.status === 'failed') {
    alerts.push({ severity: 'critical', code: 'LIVENESS_PROBE_FAILED' });
  }
  if (health?.ready?.status === 'failed') {
    alerts.push({ severity: 'critical', code: 'READINESS_PROBE_FAILED' });
  }

  return {
    source: 'application_log_batch',
    counters: {
      httpRequests: summary.httpRequests,
      http429: summary.http429,
      http503: summary.http503,
      redisOutages: summary.redisOutages,
      redisRecoveries: summary.redisRecoveries,
      ignoredLines: summary.ignoredLines,
    },
    ratios: { http429Percent, http503Percent },
    probes: health ?? { live: { status: 'not_checked' }, ready: { status: 'not_checked' } },
    alerts,
  };
}

/** GET only the two public health endpoints; never return URLs or bodies. */
export async function probeHealth(baseUrl, fetchFn = fetch) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username ||
      base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Invalid health base URL (must be an HTTP(S) origin without credentials)');
  }
  async function check(path) {
    try {
      const response = await fetchFn(new URL(path, base.origin), {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(3_000),
      });
      return { status: response.status === 200 ? 'ok' : 'failed',
        httpStatus: Number.isInteger(response.status) ? response.status : null };
    } catch {
      return { status: 'failed', httpStatus: null };
    }
  }
  const [live, ready] = await Promise.all([check('/health/live'), check('/health/ready')]);
  return { live, ready };
}

export function parseArgs(args) {
  let baseUrl;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && typeof args[i + 1] === 'string') {
      if (baseUrl !== undefined) throw new Error('Duplicate --base-url');
      baseUrl = args[++i];
    } else {
      throw new Error('Unrecognized monitoring argument');
    }
  }
  return { baseUrl };
}

async function main() {
  try {
    const { baseUrl } = parseArgs(process.argv.slice(2));
    const summary = emptySummary();
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
      addLogLine(summary, line);
    }
    const health = baseUrl ? await probeHealth(baseUrl) : null;
    const report = buildReport(summary, health);
    process.stdout.write(JSON.stringify(report) + '\n');
    if (report.alerts.some((alert) => alert.severity === 'critical')) {
      process.exitCode = 2;
    }
  } catch {
    // A user-provided URL could contain secrets; never echo it or an error.
    process.stderr.write('Monitoring report failed: invalid input or configuration\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
