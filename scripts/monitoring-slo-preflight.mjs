#!/usr/bin/env node
/**
 * Read-only, fail-closed HTTP SLO rollout preflight. No shell commands,
 * Docker access, Prometheus mutations, Alertmanager requests or notifications.
 * Only explicit operator-provided origins and local inventory are used.
 */
import { readFileSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseSloInventory } from './monitoring-slo-inventory.mjs';

const JOB = 'gym-api-internal-http';
const TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_INVENTORY_BYTES = 65_536;
const MAX_SAMPLE_AGE_SECONDS = 120;

const BOOLEAN_METRICS = Object.freeze([
  'gym_api:multi:http_targets_up',
  'gym_api:multi:http_source_complete',
  'gym_api:multi:http_histogram_complete',
  'gym_api:migration:inventory_fresh',
  'gym_api:migration:inventory_matches',
  'gym_api:migration:historical_inventory_matches_30d',
  'gym_api:migration:http_history_ready_30d',
]);

const COVERAGE_METRICS = Object.freeze([
  'gym_api:migration:http_scrape_coverage_30d',
  'gym_api:migration:http_scrape_success_30d',
  'gym_api:migration:http_counter_coverage_30d',
]);

const VALUE_METRICS = Object.freeze([
  'gym_api:migration:http_availability_verified_30d',
  'gym_api:migration:http_error_budget_consumed_verified_30d',
]);

export const PREFLIGHT_METRICS = Object.freeze([
  ...BOOLEAN_METRICS, ...COVERAGE_METRICS, ...VALUE_METRICS,
]);

export class PreflightError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PreflightError';
    this.code = code;
  }
}

export function parsePreflightArgs(args) {
  const values = new Map();
  const expected = new Set([
    '--origin', '--inventory', '--token-file', '--deployment',
    '--allow-local-http',
  ]);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!expected.has(key) || values.has(key)) throw new PreflightError('INVALID_ARGUMENTS');
    if (key === '--allow-local-http') {
      values.set(key, 'true');
      continue;
    }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new PreflightError('INVALID_ARGUMENTS');
    values.set(key, value);
  }
  for (const required of ['--origin', '--inventory', '--token-file', '--deployment']) {
    if (!values.has(required)) throw new PreflightError('INVALID_ARGUMENTS');
  }
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(values.get('--deployment'))) {
    throw new PreflightError('INVALID_DEPLOYMENT');
  }
  for (const key of ['--inventory', '--token-file']) {
    if (!isAbsolute(values.get(key))) throw new PreflightError('INVALID_FILE_PATH');
  }
  return {
    origin: validatePrometheusOrigin(
      values.get('--origin'), values.has('--allow-local-http'),
    ),
    inventoryPath: values.get('--inventory'),
    tokenPath: values.get('--token-file'),
    deployment: values.get('--deployment'),
  };
}

export function validatePrometheusOrigin(input, allowLocalHttp = false) {
  let url;
  try { url = new URL(input); }
  catch { throw new PreflightError('INVALID_PROMETHEUS_ORIGIN'); }

  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' &&
      !(allowLocalHttp && loopback && url.protocol === 'http:')) {
    throw new PreflightError('INSECURE_PROMETHEUS_ORIGIN');
  }
  if (url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash || url.origin === 'null') {
    throw new PreflightError('INVALID_PROMETHEUS_ORIGIN');
  }
  return url.origin;
}

function readSmallRegularFile(path, maxBytes, errorCode) {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.size > maxBytes) throw Error('Unsafe file');
    return readFileSync(path, 'utf8');
  } catch {
    throw new PreflightError(errorCode);
  }
}

export function readPreflightInput(inventoryPath, tokenPath, deployment) {
  let deployments;
  try {
    deployments = parseSloInventory(
      readSmallRegularFile(inventoryPath, MAX_INVENTORY_BYTES, 'INVALID_INVENTORY'),
    );
  } catch {
    throw new PreflightError('INVALID_INVENTORY');
  }
  const selected = deployments.find(item => item.name === deployment);
  if (!selected) throw new PreflightError('DEPLOYMENT_NOT_IN_INVENTORY');

  const token = readSmallRegularFile(tokenPath, 512, 'INVALID_TOKEN_FILE')
    .replace(/\r?\n$/, '');
  if (!/^[\x21-\x7e]{20,512}$/.test(token)) {
    throw new PreflightError('INVALID_TOKEN_FILE');
  }
  return { expectedInstances: selected.instances, token };
}

/** Strictly bounded response reader; never follows redirects or logs raw data. */
export async function prometheusGet(origin, endpoint, token, fetchImpl = fetch) {
  const url = new URL(endpoint, origin);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PreflightError('PROMETHEUS_UNREACHABLE');
  }
  if (!response.ok) throw new PreflightError('PROMETHEUS_HTTP_ERROR');
  if (!response.body) throw new PreflightError('PROMETHEUS_INVALID_RESPONSE');

  let bytes = 0;
  const chunks = [];
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new PreflightError('PROMETHEUS_RESPONSE_TOO_LARGE');
      chunks.push(chunk);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (payload?.status !== 'success' || typeof payload.data !== 'object' ||
        payload.data === null) throw new PreflightError('PROMETHEUS_INVALID_RESPONSE');
    return payload.data;
  } catch (err) {
    if (err instanceof PreflightError) throw err;
    throw new PreflightError('PROMETHEUS_INVALID_RESPONSE');
  }
}

export function parseActiveTargets(data, deployment, expectedInstances, nowSeconds) {
  if (!Array.isArray(data?.activeTargets) || data.activeTargets.length > 1000) {
    throw new PreflightError('PROMETHEUS_TARGETS_INVALID');
  }
  const actual = new Map();
  const reasons = new Set();
  const expected = new Set(expectedInstances);
  for (const item of data.activeTargets) {
    if (item?.labels?.job !== JOB || item.labels.deployment !== deployment) continue;
    const instance = item.labels.instance;
    if (typeof instance !== 'string' || !instance || actual.has(instance)) {
      reasons.add('TARGET_IDENTITY_INVALID');
      continue;
    }
    actual.set(instance, item);
    if (item.health !== 'up') reasons.add('TARGET_UNHEALTHY');
    if (item.scrapeInterval !== '30s') reasons.add('SCRAPE_INTERVAL_MISMATCH');
    const when = Date.parse(item.lastScrape) / 1000;
    if (!Number.isFinite(when) || nowSeconds - when > MAX_SAMPLE_AGE_SECONDS ||
        when - nowSeconds > 60) reasons.add('TARGET_SCRAPE_STALE');
  }
  if (actual.size !== expected.size ||
      [...actual.keys()].some(id => !expected.has(id))) {
    reasons.add('TARGET_INVENTORY_MISMATCH');
  }
  return { observed: actual.size, reasons: [...reasons].sort() };
}

/** Expect ONE fresh scalar value per deployment; missing/NaN is never success. */
export function parseMetricValue(data, deployment, metric, nowSeconds) {
  if (data?.resultType !== 'vector' || !Array.isArray(data.result) ||
      data.result.length > 200) throw new PreflightError('PROMETHEUS_QUERY_INVALID');
  const records = data.result.filter(item => item?.metric?.deployment === deployment);
  if (records.length === 0) return null;
  if (records.length !== 1 || records.some(item =>
      item.metric.__name__ !== metric ||
      Object.keys(item.metric).some(k => !['deployment', '__name__'].includes(k)) ||
      !Array.isArray(item.value) || item.value.length !== 2
    )) throw new PreflightError('PROMETHEUS_QUERY_INVALID');
  const sample = records[0].value;
  const timestamp = Number(sample[0]);
  const number = Number(sample[1]);
  if (!Number.isFinite(number) || !Number.isFinite(timestamp) ||
      timestamp > nowSeconds + 60 || nowSeconds - timestamp > MAX_SAMPLE_AGE_SECONDS) {
    return null;
  }
  return number;
}

export async function evaluateSloPreflight({
  origin, deployment, expectedInstances, token, nowSeconds = Date.now() / 1000,
  fetchImpl = fetch,
}) {
  const reasons = new Set();
  const report = {
    version: 1, checkedAt: new Date(nowSeconds * 1000).toISOString(),
    deployment, status: 'BLOCKED',
    expectedReplicas: expectedInstances.length,
    observedReplicas: null, checks: {}, reasons: [],
  };

  try {
    const targets = await prometheusGet(
      origin, '/api/v1/targets?state=active', token, fetchImpl,
    );
    const evaluation = parseActiveTargets(
      targets, deployment, expectedInstances, nowSeconds,
    );
    report.observedReplicas = evaluation.observed;
    for (const reason of evaluation.reasons) reasons.add(reason);

    for (const metric of PREFLIGHT_METRICS) {
      const path = '/api/v1/query?query=' + encodeURIComponent(
        metric + '{deployment="' + deployment + '"}',
      );
      const data = await prometheusGet(origin, path, token, fetchImpl);
      const value = parseMetricValue(data, deployment, metric, nowSeconds);
      const check = metric.split(':').at(-1);
      report.checks[check] = value;
      if (value === null) {
        reasons.add('MISSING_OR_STALE_' + check.toUpperCase());
      } else if (BOOLEAN_METRICS.includes(metric) && value !== 1) {
        reasons.add('NOT_READY_' + check.toUpperCase());
      } else if (COVERAGE_METRICS.includes(metric) && value < 0.99) {
        reasons.add('INSUFFICIENT_' + check.toUpperCase());
      } else if (metric.endsWith('http_availability_verified_30d') &&
          (value < 0 || value > 1)) {
        reasons.add('INVALID_SLO_AVAILABILITY');
      } else if (metric.endsWith('http_error_budget_consumed_verified_30d') &&
          value < 0) {
        reasons.add('INVALID_ERROR_BUDGET');
      }
    }
  } catch (err) {
    reasons.add(err instanceof PreflightError ?
      err.code : 'PROMETHEUS_QUERY_FAILED');
  }
  report.reasons = [...reasons].sort();
  if (!report.reasons.length) report.status = 'READY_FOR_REVIEW';
  return report;
}

async function main(argv) {
  // No raw CLI argument, exception or response body is ever written to output.
  let config;
  try { config = parsePreflightArgs(argv); }
  catch (err) {
    process.stdout.write(JSON.stringify({
      version: 1, status: 'BLOCKED',
      reasons: [err instanceof PreflightError ? err.code : 'INVALID_ARGUMENTS'],
    }) + '\n');
    process.exitCode = 2;
    return;
  }

  try {
    const { expectedInstances, token } = readPreflightInput(
      config.inventoryPath, config.tokenPath, config.deployment,
    );
    const report = await evaluateSloPreflight({
      ...config, expectedInstances, token,
    });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.status !== 'READY_FOR_REVIEW') process.exitCode = 2;
  } catch (err) {
    process.stdout.write(JSON.stringify({
      version: 1, deployment: config.deployment, status: 'BLOCKED',
      reasons: [err instanceof PreflightError ? err.code : 'PREFLIGHT_FAILED'],
    }) + '\n');
    process.exitCode = 2;
  }
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
