import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const rules = read('ops/monitoring/http-slo-migration.rules.yml');
const simulations = read('ops/monitoring/http-slo-migration.test.yml');
const source = read('scripts/monitoring-slo-inventory.mjs');
const example = JSON.parse(read('ops/monitoring/http-slo-inventory.example.json'));
const dashboard = JSON.parse(read('ops/monitoring/grafana/gym-api-multi-instance.json'));
const workflow = read('.github/workflows/ci.yml');

test('inventory source is operator-controlled and its label identity avoids exporter collisions', () => {
  assert.equal(example.version, 1);
  assert.equal(example.scrapeIntervalSeconds, 30);
  assert.ok(example.deployments.every(d => d.name.includes('example')));
  assert.match(source, /parseSloInventory/);
  assert.match(source, /target_instance/);
  assert.match(source, /slo_deployment/);
  assert.match(source, /renameSync/);
  assert.match(source, /fsyncSync/);
  assert.match(rules, /max by \(deployment, instance\)/);
  assert.match(rules, /"instance", "\$1", "target_instance"/);
  assert.match(rules, /"deployment", "\$1", "slo_deployment"/);
  assert.doesNotMatch(rules, /\{(?:user_id|email|route|request_id|authorization)=/);
});

test('exact source membership and current inventory freshness are required for verified 5m SLO', () => {
  for (const name of [
    'gym_api:migration:expected_target',
    'gym_api:migration:expected_replicas',
    'gym_api:migration:inventory_fresh',
    'gym_api:migration:observed_replicas',
    'gym_api:migration:matched_replicas',
    'gym_api:migration:inventory_matches',
    'gym_api:migration:http_availability_verified_5m',
  ]) assert.ok(rules.includes('record: ' + name), name);
  assert.match(rules, /and on \(deployment, instance\) gym_api:migration:expected_target/);
  assert.match(rules, /gym_api:migration:observed_replicas[\s\S]*== bool on \(deployment\) gym_api:migration:expected_replicas/);
  assert.match(rules, /gym_api:migration:matched_replicas[\s\S]*== bool on \(deployment\) gym_api:migration:expected_replicas/);
  assert.match(rules, /time\(\) - gym_api:migration:inventory_refresh_timestamp_seconds < bool 900/);
  assert.match(rules, /gym_api:migration:inventory_matches == 1/);
  assert.match(rules, /gym_api:migration:inventory_fresh == 1/);
});

test('30d SLO requires historical replica identity and high sample coverage, never short warm-up', () => {
  assert.match(rules, /max_over_time\(up\{job="gym-api-internal-http",deployment=~"\.\+"\}\[30d\]\)/);
  assert.match(rules, /count_over_time\(up\{job="gym-api-internal-http",deployment=~"\.\+"\}\[30d\]\)/);
  assert.match(rules, /count_over_time\(gym_api_http_requests_total\{job="gym-api-internal-http",deployment=~"\.\+",status_class=~"2xx\|3xx\|5xx"\}\[30d\]\)/);
  assert.match(rules, /\/ 86400/);
  assert.match(rules, />= bool 0\.99/);
  assert.match(rules, /http_scrape_success_30d/);
  assert.match(rules, /historical_inventory_matches_30d/);
  assert.match(rules, /gym_api:migration:http_history_ready_30d == 1/);
  for (const name of [
    'gym_api:migration:http_availability_verified_30d',
    'gym_api:migration:http_error_budget_consumed_verified_30d',
    'gym_api:migration:http_error_budget_remaining_verified_30d',
  ]) assert.ok(rules.includes('record: ' + name));
  for (const scenario of [
    'two exact expected replicas verify short SLI',
    'same replica count but wrong instance identity',
    'stale inventory hides verified SLI',
    'missing inventory is not healthy',
  ]) assert.ok(simulations.includes(scenario));
  assert.doesNotMatch(rules, /(?:rate|increase)\(sum/);
});

test('opt-in missing, stale and mismatch warnings are independent of API outage alerts', () => {
  for (const alert of [
    'GymApiSloInventoryMissing',
    'GymApiSloInventoryStale',
    'GymApiSloInventoryMismatch',
  ]) {
    assert.ok(rules.includes('alert: ' + alert));
    assert.ok(simulations.includes('alertname: ' + alert));
  }
  assert.match(rules, /for: 5m/);
  assert.doesNotMatch(read('ops/monitoring/alerts.rules.yml'), /GymApiSloInventory/);
  assert.match(workflow, /check rules \/rules\/http-slo-migration.rules.yml/);
  assert.match(workflow, /test rules \/rules\/http-slo-migration.test.yml/);
  assert.doesNotMatch(workflow, /systemctl (enable|start) .*slo-inventory/);
});

test('Grafana defaults to verified 30d SLI, shows No Data and filters one deployment', () => {
  const queries = dashboard.panels.map(p => p.targets[0].expr);
  assert.ok(dashboard.panels.length >= 25);
  assert.equal(new Set(dashboard.panels.map(p => p.id)).size, dashboard.panels.length);
  const selected = dashboard.templating.list.find(v => v.name === 'deployment');
  assert.equal(selected.multi, false);
  assert.equal(selected.includeAll, false);
  for (const panel of dashboard.panels) {
    assert.ok(panel.targets[0].expr.includes('deployment="$deployment"'));
    assert.equal(panel.datasource.uid, '${DS_PROMETHEUS}');
  }
  for (const name of [
    'gym_api:migration:http_availability_verified_5m',
    'gym_api:migration:http_availability_verified_30d',
    'gym_api:migration:http_error_budget_consumed_verified_30d',
    'gym_api:migration:http_error_budget_remaining_verified_30d',
    'gym_api:migration:inventory_matches',
    'gym_api:migration:http_history_ready_30d',
    'gym_api:migration:http_scrape_coverage_30d',
  ]) assert.ok(queries.some(q => q.includes(name)), name);
  for (const id of [4, 5, 6, 7]) {
    assert.ok(dashboard.panels.find(p => p.id === id).targets[0].expr.includes('gym_api:migration:'));
  }
  assert.doesNotMatch(JSON.stringify(dashboard), /Bearer|password|access_token|api_key/i);
});
