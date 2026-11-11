import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const rules = read('ops/monitoring/slo.rules.yml');
const testRules = read('ops/monitoring/slo.test.yml') + '\n' +
  read('ops/monitoring/http-metrics.slo.test.yml');
const dashboard = JSON.parse(read('ops/monitoring/grafana/gym-api-overview.json'));
const exporter = read('scripts/monitoring-textfile.mjs');
const resource = read('scripts/monitoring-docker-resources.mjs');
const signals = read('scripts/monitoring-docker-signals.mjs');

const records = [...rules.matchAll(/^\s+- record: ([a-z][a-z0-9_:]*)$/gm)]
  .map(match => match[1]);

test('recording rules are fixed, non-labeled and constrained by source freshness', () => {
  assert.deepEqual(records, [
    'gym_api:sli:monitor_snapshot_fresh',
    'gym_api:sli:readiness_observed',
    'gym_api:sli:readiness_observed_ratio_1h',
    'gym_api:sli:readiness_observed_ratio_24h',
    'gym_api:sli:readiness_coverage_ratio_24h',
    'gym_api:sli:http_503_share_5m',
    'gym_api:sli:http_429_share_5m',
    'gym_api:sli:http_eligible_requests_5m',
    'gym_api:sli:http_5xx_ratio_5m',
    'gym_api:sli:http_availability_5m',
    'gym_api:sli:http_availability_30d',
    'gym_api:sli:http_duration_p50_seconds_5m',
    'gym_api:sli:http_duration_p95_seconds_5m',
    'gym_api:sli:http_duration_p99_seconds_5m',
  ]);
  assert.doesNotMatch(rules, /^\s+labels:/m);
  assert.match(rules, /gym_api_monitor_last_run_timestamp_seconds < 900/);
  assert.match(rules, /gym_api_monitor_ready_probe_success >= 0/);
  assert.match(rules, /gym_api_monitor_http_requests_window_5m >= 20/);
  assert.match(rules, /readiness_coverage_ratio_24h[\s\S]*count_over_time/);
  assert.match(rules, /readiness_observed_ratio_24h[\s\S]*avg_over_time/);
  assert.doesNotMatch(rules, /(?:rate|increase)\(gym_api_monitor_http_/);
  assert.doesNotMatch(rules, /\b(alert|severity):/);
  for (const name of records) {
    assert.ok(testRules.includes(name), 'Recording rule lacks test coverage: ' + name);
  }
});

test('Grafana import is datasource-agnostic, unique and low cardinality', () => {
  assert.equal(dashboard.uid, 'gym-api-observability');
  assert.equal(dashboard.id, null);
  assert.ok(dashboard.panels.length >= 12);
  assert.equal(dashboard.refresh, '1m');
  assert.deepEqual(dashboard.templating.list, []);
  assert.equal(dashboard.__inputs.length, 1);
  assert.equal(dashboard.__inputs[0].pluginId, 'prometheus');
  const ids = dashboard.panels.map(panel => panel.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const panel of dashboard.panels) {
    assert.ok(panel.description.length > 20);
    assert.ok(panel.gridPos.w > 0 && panel.gridPos.h > 0);
    assert.deepEqual(panel.datasource, {
      type: 'prometheus', uid: '${DS_PROMETHEUS}',
    });
    assert.equal(panel.targets.length, 1);
    assert.equal(panel.targets[0].refId, 'A');
    assert.deepEqual(panel.targets[0].datasource, panel.datasource);
    assert.doesNotMatch(panel.targets[0].expr, /\{[^}]+\}|https?:\/\//);
  }
  assert.doesNotMatch(JSON.stringify(dashboard), /bearer|password|email@|token:|127\.0\.0\.1/i);
});

test('dashboard does not treat window gauges as counters or claim latency SLO', () => {
  const queries = dashboard.panels.map(panel => panel.targets[0].expr);
  for (const name of [
    'gym_api:sli:readiness_observed_ratio_24h',
    'gym_api:sli:readiness_coverage_ratio_24h',
    'gym_api:sli:http_503_share_5m',
    'gym_api:sli:monitor_snapshot_fresh',
  ]) assert.ok(queries.includes(name));
  assert.ok(queries.some(expr => expr.includes('gym_api_docker_cpu_throttled_periods_total')));
  assert.ok(queries.some(expr => expr.includes('node_textfile_scrape_error')));
  assert.ok(dashboard.panels.some(panel => /not measured end-user availability/i.test(panel.description)));
  assert.ok(dashboard.panels.some(panel => /not a latency metric/i.test(panel.description)));
  for (const expr of queries) {
    assert.doesNotMatch(expr, /(?:rate|increase)\(gym_api_monitor_http_/);
  }
  for (const reference of [
    'gym_api_monitor_http_requests_window_5m',
    'gym_api_monitor_ready_probe_success',
  ]) assert.ok(exporter.includes(reference));
  assert.ok(resource.includes('gym_api_docker_memory_percent'));
  assert.ok(signals.includes('gym_api_docker_cpu_throttled_periods_total'));
});

test('real HTTP availability and histogram queries use monotonic counters only', () => {
  const metrics = read('src/common/http-metrics/http-metrics.registry.ts');
  assert.match(metrics, /gym_api_http_requests_total/);
  assert.match(metrics, /gym_api_http_request_duration_seconds_bucket/);
  assert.match(rules, /increase\(gym_api_http_requests_total/);
  assert.match(rules, /histogram_quantile\(0\.95/);
  assert.match(rules, /gym_api:sli:http_availability_30d/);
  assert.match(rules, /gym_api:sli:http_eligible_requests_5m >= 20/);
  assert.doesNotMatch(metrics, /userId|email|originalUrl|authorization|requestId/);
  const queries = dashboard.panels.map(panel => panel.targets[0].expr);
  for (const metric of [
    'gym_api:sli:http_availability_5m',
    'gym_api:sli:http_availability_30d',
    'gym_api:sli:http_duration_p50_seconds_5m',
    'gym_api:sli:http_duration_p95_seconds_5m',
    'gym_api:sli:http_duration_p99_seconds_5m',
  ]) assert.ok(queries.includes(metric));
});
