import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const budgetRules = read('ops/monitoring/http-slo-burn.rules.yml');
const testRules = read('ops/monitoring/http-slo-burn.test.yml');
const alertRules = read('ops/monitoring/alerts.rules.yml');
const primarySli = read('ops/monitoring/slo.rules.yml');
const workflow = read('.github/workflows/ci.yml');
const dashboard = JSON.parse(read('ops/monitoring/grafana/gym-api-overview.json'));

test('burn rules use real bounded-cardinality HTTP counters and a provisional 99.9% objective', () => {
  for (const name of [
    'gym_api:slo:http_eligible_requests_1h',
    'gym_api:slo:http_eligible_requests_30m',
    'gym_api:slo:http_eligible_requests_6h',
    'gym_api:slo:http_5xx_ratio_1h',
    'gym_api:slo:http_5xx_ratio_30m',
    'gym_api:slo:http_5xx_ratio_6h',
    'gym_api:slo:http_error_budget_consumed_30d',
    'gym_api:slo:http_error_budget_remaining_30d',
  ]) {
    assert.ok(budgetRules.includes('record: ' + name));
    assert.ok(budgetRules.includes('gym_api:slo:'), name);
  }
  assert.match(budgetRules, /\)\s*\/ 0\.001/);
  assert.match(budgetRules, /clamp_min\(1 - gym_api:slo:http_error_budget_consumed_30d, 0\)/);
  assert.match(budgetRules, /gym_api_http_requests_total\{status_class=~"2xx\|3xx\|5xx"\}/);
  assert.match(budgetRules, /gym_api_http_requests_total\{status_class="5xx"\}/);
  assert.doesNotMatch(budgetRules, /gym_api_monitor_http_.*_window_5m/);
  assert.doesNotMatch(budgetRules, /\{(?:user|route|path|request_id|email|method)=/);
  assert.doesNotMatch(budgetRules, /https?:\/\/|password|bearer|token/);
  assert.match(primarySli, /record: gym_api:sli:http_5xx_ratio_5m/);
});

test('fast/slow multi-window alert thresholds require sustained traffic', () => {
  assert.match(budgetRules, /gym_api:sli:http_5xx_ratio_5m > 0\.0144/);
  assert.match(budgetRules, /gym_api:slo:http_5xx_ratio_1h > 0\.0144/);
  assert.match(budgetRules, /gym_api:sli:http_eligible_requests_5m >= 50/);
  assert.match(budgetRules, /gym_api:slo:http_eligible_requests_1h >= 500/);
  assert.match(budgetRules, /gym_api:slo:http_5xx_ratio_30m > 0\.006/);
  assert.match(budgetRules, /gym_api:slo:http_5xx_ratio_6h > 0\.006/);
  assert.match(budgetRules, /gym_api:slo:http_eligible_requests_30m >= 200/);
  assert.match(budgetRules, /gym_api:slo:http_eligible_requests_6h >= 1000/);
  for (const name of [
    'GymApiHttpSloFastBurn', 'GymApiHttpSloSlowBurn', 'GymApiHttpSloMetricsMissing',
  ]) {
    assert.match(budgetRules, new RegExp('alert: ' + name));
    assert.match(testRules, new RegExp('alertname: ' + name));
  }
  assert.match(budgetRules, /absent\(sum\(gym_api_http_requests_total\{status_class="5xx"\}\)\)/);
  assert.match(budgetRules, /for: 10m/);
  // Optional rules are separate: no production auto-activation in the legacy alert file.
  assert.doesNotMatch(alertRules, /GymApiHttpSloFastBurn|GymApiHttpSloSlowBurn/);
});

test('promtool runs on CI and dashboard displays both error budget and context', () => {
  assert.match(workflow, /check rules \/rules\/http-slo-burn\.rules\.yml/);
  assert.match(workflow, /test rules \/rules\/http-slo-burn\.test\.yml/);
  assert.doesNotMatch(workflow, /systemctl (start|enable) .*slo/);
  const queries = dashboard.panels.map(panel => panel.targets[0].expr);
  for (const name of [
    'gym_api:slo:http_error_budget_consumed_30d',
    'gym_api:slo:http_error_budget_remaining_30d',
    'gym_api:slo:http_5xx_ratio_1h',
    'gym_api:slo:http_5xx_ratio_30m',
    'gym_api:slo:http_5xx_ratio_6h',
  ]) assert.ok(queries.includes(name), name);
  assert.equal(dashboard.panels.length, 30);
  assert.equal(new Set(dashboard.panels.map(panel => panel.id)).size, 30);
  for (const panel of dashboard.panels) {
    assert.equal(panel.targets[0].datasource.uid, '${DS_PROMETHEUS}');
    assert.ok(panel.description.length > 20);
    assert.doesNotMatch(panel.targets[0].expr, /(?:rate|increase)\(gym_api_monitor_http_/);
  }
});
