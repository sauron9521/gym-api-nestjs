import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const registry = read('src/common/http-metrics/http-metrics.registry.ts');
const middleware = read('src/common/request-context/request-context.middleware.ts');
const controller = read('src/common/http-metrics/http-metrics.controller.ts');
const ci = read('.github/workflows/ci.yml');
const rules = read('ops/monitoring/http-telemetry.rules.yml');
const ruleTests = read('ops/monitoring/http-telemetry.test.yml');
const legacyRules = read('ops/monitoring/alerts.rules.yml');
const dashboard = JSON.parse(read('ops/monitoring/grafana/gym-api-overview.json'));

test('HTTP telemetry distinguishes started, aborted, completed, and active requests', () => {
  for (const metric of [
    'gym_api_http_requests_started_total',
    'gym_api_http_requests_aborted_total',
    'gym_api_http_requests_in_flight',
  ]) assert.ok(registry.includes(metric), metric);
  assert.match(middleware, /requestStarted\(\)/);
  assert.match(middleware, /requestCompleted\(response.statusCode, durationSeconds\)/);
  assert.match(middleware, /requestAborted\(\)/);
  assert.match(middleware, /response.once\('finish'/);
  assert.match(middleware, /response.once\('close'/);
  assert.match(middleware, /if \(settled\) return/);
  assert.match(middleware, /internal\\\/metrics/);
  assert.doesNotMatch(registry, /userId|email|originalUrl|authorization|requestId/);
  assert.doesNotMatch(registry, /\{(?:user|route|path|ip|token|request_id)=/);
});

test('protected scraper stays opt-in and does not count scrapes as SLO traffic', () => {
  assert.match(controller, /HTTP_METRICS_ENABLED/);
  assert.match(controller, /HTTP_METRICS_TOKEN/);
  assert.match(controller, /timingSafeEqual/);
  assert.match(controller, /NotFoundException/);
  assert.match(controller, /@ApiExcludeController/);
  const e2e = read('test/http-metrics.e2e-spec.ts');
  assert.match(e2e, /real TCP client disconnect/);
  assert.match(e2e, /\/INTERNAL\/METRICS/);
  assert.match(e2e, /server.closeAllConnections/);
});

test('per-target scrape alerts are opt-in, bounded and checked by CI', () => {
  assert.match(rules, /sum\(increase\(gym_api_http_requests_started_total\[5m\]\)\)/);
  assert.match(rules, /sum\(increase\(gym_api_http_requests_aborted_total\[5m\]\)\)/);
  assert.match(rules, /gym_api:telemetry:http_starts_5m >= 20/);
  assert.match(rules, /gym_api:telemetry:http_starts_5m >= 100/);
  assert.match(rules, /up\{job="gym-api-internal-http"\} == 0/);
  assert.match(rules, /absent\(sum\(up\{job="gym-api-internal-http"\}\)\)/);
  assert.doesNotMatch(legacyRules, /GymApiHttpAbortedResponsesElevated/);
  for (const alert of [
    'GymApiHttpMetricsTargetDown',
    'GymApiHttpMetricsJobMissing',
    'GymApiHttpAbortedResponsesElevated',
  ]) {
    assert.ok(rules.includes('alert: ' + alert), alert);
    assert.ok(ruleTests.includes('alertname: ' + alert), alert);
  }
  assert.match(ci, /check rules \/rules\/http-telemetry.rules.yml/);
  assert.match(ci, /test rules \/rules\/http-telemetry.test.yml/);
  assert.doesNotMatch(rules, /user_id|email|bearer|token|originalUrl/);
});

test('Grafana models aborts separately from HTTP error-budget consumption', () => {
  assert.equal(dashboard.panels.length, 34);
  assert.equal(new Set(dashboard.panels.map(p => p.id)).size, 34);
  const queries = dashboard.panels.map(p => p.targets[0].expr);
  for (const metric of [
    'gym_api:telemetry:http_starts_5m',
    'gym_api:telemetry:http_aborts_5m',
    'gym_api:telemetry:http_abort_ratio_5m',
    'gym_api:telemetry:http_in_flight',
    'gym_api:slo:http_error_budget_consumed_30d',
  ]) assert.ok(queries.includes(metric), metric);
  assert.ok(dashboard.panels.some(p => p.description.includes('no completed status class')));
});
