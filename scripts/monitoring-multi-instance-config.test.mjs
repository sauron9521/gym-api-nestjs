import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const rules = read('ops/monitoring/http-multi-instance.rules.yml');
const simulations = read('ops/monitoring/http-multi-instance.test.yml');
const legacySli = read('ops/monitoring/slo.rules.yml');
const legacyBudget = read('ops/monitoring/http-slo-burn.rules.yml');
const workflow = read('.github/workflows/ci.yml');
const dashboard = JSON.parse(read('ops/monitoring/grafana/gym-api-multi-instance.json'));

test('multi-instance records are deployment-scoped and gated on target health', () => {
  const records = [...rules.matchAll(/^\s+- record: ([a-zA-Z_:][a-zA-Z0-9_:]*)/gm)]
    .map(m => m[1]);
  assert.ok(records.length >= 20);
  for (const record of records) assert.ok(record.startsWith('gym_api:multi:'), record);
  assert.equal(new Set(records).size, records.length);
  assert.match(rules, /min by \(deployment\) \(up\{job="gym-api-internal-http",deployment=~"\.\+"\}\)/);
  assert.match(rules, /count by \(deployment\)/);
  assert.match(rules, /gym_api:multi:http_targets_up/);
  assert.match(rules, /gym_api:multi:http_source_complete == 1/);
  assert.match(rules, /gym_api:multi:http_histogram_complete == 1/);
  assert.match(rules, /and on \(deployment\)/);
  assert.match(rules, /gym_api:multi:http_eligible_requests_30d >= 1000/);
  assert.doesNotMatch(rules, /gym_api_monitor_http_.*_window_5m/);
  assert.doesNotMatch(rules, /\{(?:user|email|route|method|request_id|ip)=/);
});

test('rate and increase are always calculated BEFORE cross-replica aggregation', () => {
  assert.match(rules, /sum by \(deployment\) \(increase\(gym_api_http_requests_total\{/);
  assert.match(rules, /sum by \(deployment, le\) \(rate\(gym_api_http_request_duration_seconds_bucket\{/);
  assert.doesNotMatch(rules, /(?:rate|increase)\(sum\b/);
  assert.match(rules, /job="gym-api-internal-http",deployment=~"\.\+"/);
  for (const suffix of ['p50_seconds_5m', 'p95_seconds_5m', 'p99_seconds_5m']) {
    assert.ok(rules.includes('record: gym_api:multi:http_duration_' + suffix));
  }
  for (const name of [
    'GymApiMultiHttpSloFastBurn',
    'GymApiMultiHttpSloSlowBurn',
    'GymApiMultiHttpMetricsIncomplete',
  ]) {
    assert.ok(rules.includes('alert: ' + name));
    assert.ok(simulations.includes('alertname: ' + name));
  }
  for (const input of [
    'one down replica suppresses healthy-looking SLI',
    'counter and histogram reset in one replica',
    'production replicas aggregate without mixing staging',
    'missing deployment label or unrelated job',
  ]) assert.ok(simulations.includes(input));
});

test('existing single-service files remain unmodified and separately installable', () => {
  assert.match(legacySli, /gym_api:sli:http_eligible_requests_5m/);
  assert.match(legacyBudget, /gym_api:slo:http_eligible_requests_1h/);
  assert.doesNotMatch(legacySli, /gym_api:multi:/);
  assert.doesNotMatch(legacyBudget, /GymApiMultiHttpSlo/);
  assert.match(workflow, /check rules \/rules\/http-multi-instance.rules.yml/);
  assert.match(workflow, /test rules \/rules\/http-multi-instance.test.yml/);
});

test('dedicated Grafana dashboard never mingles staging and production by default', () => {
  assert.equal(dashboard.uid, 'gym-api-multi-instance');
  assert.equal(dashboard.id, null);
  assert.equal(dashboard.__inputs.length, 1);
  assert.equal(dashboard.__inputs[0].pluginId, 'prometheus');
  assert.ok(dashboard.panels.length >= 15);
  assert.equal(new Set(dashboard.panels.map(p => p.id)).size, dashboard.panels.length);
  const vars = dashboard.templating.list;
  assert.equal(vars.length, 1);
  assert.equal(vars[0].name, 'deployment');
  assert.equal(vars[0].multi, false);
  assert.equal(vars[0].includeAll, false);
  assert.match(vars[0].definition, /label_values\(gym_api:multi:http_targets_up, deployment\)/);
  for (const panel of dashboard.panels) {
    assert.deepEqual(panel.datasource, {type:'prometheus',uid:'${DS_PROMETHEUS}'});
    assert.equal(panel.targets[0].datasource.uid, '${DS_PROMETHEUS}');
    assert.ok(panel.targets[0].expr.includes('deployment="$deployment"'));
    assert.ok(panel.description.length > 30);
    assert.doesNotMatch(panel.targets[0].expr, /(?:rate|increase)\(gym_api_monitor_http_/);
  }
  const queries = dashboard.panels.map(p=>p.targets[0].expr);
  for (const name of [
    'gym_api:multi:http_availability_5m',
    'gym_api:multi:http_error_budget_consumed_30d',
    'gym_api:multi:http_duration_p95_seconds_5m',
    'gym_api:multi:http_targets_up',
    'gym_api:multi:http_histogram_complete',
  ]) assert.ok(queries.some(q=>q.includes(name)), name);
  assert.doesNotMatch(JSON.stringify(dashboard), /Bearer|password|access_token|127\.0\.0\.1|api_key/i);
});
