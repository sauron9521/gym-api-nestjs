import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  PREFLIGHT_METRICS, PreflightError, evaluateSloPreflight,
  parseActiveTargets, parseMetricValue, parsePreflightArgs,
  prometheusGet, readPreflightInput, validatePrometheusOrigin,
} from './monitoring-slo-preflight.mjs';

const TOKEN = 'a-secret-operator-only-token-value-43-characters';
const DEPLOYMENT = 'production';
const TARGETS = ['prod-a.internal:8443', 'prod-b.internal:8443'];
const manifest = JSON.stringify({
  version: 1, scrapeIntervalSeconds: 30,
  deployments: [{ name: DEPLOYMENT, instances: TARGETS }],
});
const defaultMetrics = Object.fromEntries(PREFLIGHT_METRICS.map(name => [
  name, name.includes('coverage') || name.endsWith('scrape_success_30d')
    ? 0.997 : name.endsWith('availability_verified_30d') ? 0.9995
    : name.endsWith('error_budget_consumed_verified_30d') ? 0.5 : 1,
]));

function activeTarget(instance, now, overrides = {}) {
  return {
    labels: { job: 'gym-api-internal-http', deployment: DEPLOYMENT, instance },
    health: 'up', scrapeInterval: '30s',
    lastScrape: new Date(now * 1000).toISOString(),
    ...overrides,
  };
}

function responses(now, overrides = {}) {
  const values = { ...defaultMetrics, ...overrides };
  return { values, targets: TARGETS.map(instance => activeTarget(instance, now)) };
}

async function withPrometheus(config, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, authorized:
      req.headers.authorization === 'Bearer ' + TOKEN });
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer ' + TOKEN) {
      res.statusCode = 401;
      res.end(JSON.stringify({ status: 'error', error: 'Unauthorized' }));
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/v1/targets') {
      res.end(JSON.stringify({ status: 'success', data: {
        activeTargets: config.targets,
      } }));
      return;
    }
    if (url.pathname === '/api/v1/query') {
      const query = url.searchParams.get('query') ?? '';
      const name = query.split('{')[0];
      const value = config.values[name];
      res.end(JSON.stringify({ status: 'success', data: {
        resultType: 'vector',
        result: value === undefined || value === null ? [] : [{
          metric: { __name__: name, deployment: DEPLOYMENT },
          value: [config.timestamp ?? config.now, String(value)],
        }],
      } }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw Error('No TCP port');
    return await fn('http://127.0.0.1:' + addr.port, seen);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('origin rejects credentials, HTTP remotes, redirects paths and query secrets', () => {
  assert.equal(validatePrometheusOrigin('https://prom.example.test'),
    'https://prom.example.test');
  assert.equal(validatePrometheusOrigin('http://127.0.0.1:9090', true),
    'http://127.0.0.1:9090');
  for (const [url, enabled] of [
    ['http://prom.example.test', true],
    ['http://127.0.0.1:9090', false],
    ['https://u:p@prom.example.test/', false],
    ['https://prom.example.test/api/v1', false],
    ['https://prom.example.test/?token=secret', false],
    ['https://prom.example.test/#secret', false],
  ]) assert.throws(() => validatePrometheusOrigin(url, enabled), PreflightError);
});

test('CLI arguments require explicit trusted origin, local file inputs and deployment', () => {
  const args = [
    '--origin', 'http://127.0.0.1:9090', '--allow-local-http',
    '--inventory', '/tmp/targets.json', '--token-file', '/tmp/secret',
    '--deployment', DEPLOYMENT,
  ];
  const output = parsePreflightArgs(args);
  assert.equal(output.deployment, DEPLOYMENT);
  assert.equal(output.origin, 'http://127.0.0.1:9090');
  assert.throws(() => parsePreflightArgs([...args, '--origin', 'https://other.test']));
  assert.throws(() => parsePreflightArgs(args.slice(0, -2)));
  assert.throws(() => parsePreflightArgs([...args, '--unknown']));
  assert.throws(() => parsePreflightArgs(
    args.map(x => x === DEPLOYMENT ? 'production" or on() vector(1)' : x),
  ));
});

test('inventory and bearer credentials loaded from regular files without printing secrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gym-api-preflight-'));
  try {
    const inventoryPath = join(dir, 'inventory.json');
    const tokenPath = join(dir, 'token');
    writeFileSync(inventoryPath, manifest);
    writeFileSync(tokenPath, TOKEN + '\n');
    chmodSync(tokenPath, 0o600);
    const input = readPreflightInput(inventoryPath, tokenPath, DEPLOYMENT);
    assert.deepEqual(input.expectedInstances, TARGETS);
    assert.equal(input.token, TOKEN);
    assert.throws(() => readPreflightInput(inventoryPath, tokenPath, 'staging'),
      /DEPLOYMENT_NOT_IN_INVENTORY/);
    writeFileSync(tokenPath, 'short');
    assert.throws(() => readPreflightInput(inventoryPath, tokenPath, DEPLOYMENT),
      /INVALID_TOKEN_FILE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('one fresh Prometheus value is required; duplicate, NaN and stale reject success', () => {
  const now = Date.now() / 1000;
  const mk = (value, timestamp = now) => ({
    resultType: 'vector', result: [{metric:{
      __name__: 'metric', deployment: DEPLOYMENT,
    },value:[timestamp,String(value)]}],
  });
  assert.equal(parseMetricValue(mk(1), DEPLOYMENT, 'metric', now), 1);
  assert.equal(parseMetricValue(mk('NaN'), DEPLOYMENT, 'metric', now), null);
  assert.equal(parseMetricValue(mk(1, now - 200), DEPLOYMENT, 'metric', now), null);
  assert.equal(parseMetricValue({resultType:'vector',result:[]},
    DEPLOYMENT, 'metric', now), null);
  const data = mk(1);
  data.result.push(data.result[0]);
  assert.throws(() => parseMetricValue(data, DEPLOYMENT, 'metric', now),
    /PROMETHEUS_QUERY_INVALID/);
});

test('exact scrape target identity matters more than matching the replica count', () => {
  const now = Date.now() / 1000;
  const targetData = { activeTargets: [
    activeTarget(TARGETS[0], now),
    activeTarget('an-unexpected-instance:8443', now),
  ]};
  const result = parseActiveTargets(targetData, DEPLOYMENT, TARGETS, now);
  assert.equal(result.observed, 2);
  assert.deepEqual(result.reasons, ['TARGET_INVENTORY_MISMATCH']);
  targetData.activeTargets[1].health = 'down';
  assert.deepEqual(parseActiveTargets(targetData, DEPLOYMENT, TARGETS, now).reasons,
    ['TARGET_INVENTORY_MISMATCH', 'TARGET_UNHEALTHY']);
});

test('healthy protected local Prometheus returns READY_FOR_REVIEW with no identities leaked', async () => {
  const now = Math.floor(Date.now() / 1000);
  const config = { ...responses(now), now };
  await withPrometheus(config, async (origin, seen) => {
    const report = await evaluateSloPreflight({
      origin, deployment: DEPLOYMENT, expectedInstances: TARGETS,
      token: TOKEN, nowSeconds: now,
    });
    assert.equal(report.status, 'READY_FOR_REVIEW');
    assert.deepEqual(report.reasons, []);
    assert.equal(report.expectedReplicas, 2);
    assert.equal(report.observedReplicas, 2);
    assert.equal(report.checks.http_history_ready_30d, 1);
    assert.equal(report.checks.http_availability_verified_30d, 0.9995);
    assert.equal(seen.length, PREFLIGHT_METRICS.length + 1);
    assert.ok(seen.every(x => x.method === 'GET' && x.authorized));
    assert.ok(seen.every(x => x.url.startsWith('/api/v1/')));
    const serialized = JSON.stringify(report);
    for (const forbidden of [...TARGETS, TOKEN, origin]) {
      assert.ok(!serialized.includes(forbidden));
    }
  });
});

test('preflight blocks wrong replica, low history, missing metric and stale samples', async () => {
  const now = Math.floor(Date.now() / 1000);
  const cases = [
    {
      mutate: c => {c.targets[1] = activeTarget('wrong:8443', now);},
      code: 'TARGET_INVENTORY_MISMATCH',
    },
    {
      mutate: c => {c.values['gym_api:migration:http_scrape_coverage_30d'] = 0.1;},
      code: 'INSUFFICIENT_HTTP_SCRAPE_COVERAGE_30D',
    },
    {
      mutate: c => {c.values['gym_api:migration:http_history_ready_30d'] = 0;},
      code: 'NOT_READY_HTTP_HISTORY_READY_30D',
    },
    {
      mutate: c => {delete c.values['gym_api:migration:http_availability_verified_30d'];},
      code: 'MISSING_OR_STALE_HTTP_AVAILABILITY_VERIFIED_30D',
    },
    {
      mutate: c => {c.timestamp = now - 150;},
      code: 'MISSING_OR_STALE_HTTP_TARGETS_UP',
    },
  ];
  for (const {mutate,code} of cases) {
    const c = { ...responses(now), now };
    mutate(c);
    await withPrometheus(c, async origin => {
      const report = await evaluateSloPreflight({
        origin, deployment: DEPLOYMENT, expectedInstances: TARGETS,
        token: TOKEN, nowSeconds: now,
      });
      assert.equal(report.status, 'BLOCKED', code);
      assert.ok(report.reasons.includes(code), JSON.stringify(report.reasons));
    });
  }
});

test('Prometheus authentication failure, invalid response and redirects fail closed', async () => {
  const now = Math.floor(Date.now() / 1000);
  const cfg = { ...responses(now), now };
  await withPrometheus(cfg, async origin => {
    const fail = await evaluateSloPreflight({
      origin, deployment: DEPLOYMENT, expectedInstances: TARGETS,
      token: 'wrong-token', nowSeconds: now,
    });
    assert.equal(fail.status, 'BLOCKED');
    assert.deepEqual(fail.reasons, ['PROMETHEUS_HTTP_ERROR']);
    const broken = await evaluateSloPreflight({
      origin: 'http://127.0.0.1:9', deployment: DEPLOYMENT,
      expectedInstances: TARGETS, token: TOKEN, nowSeconds: now,
    });
    assert.equal(broken.status, 'BLOCKED');
    assert.deepEqual(broken.reasons, ['PROMETHEUS_UNREACHABLE']);
  });
  assert.equal(typeof prometheusGet, 'function');
});

test('invalid CLI exits nonzero without dumping command args, credentials or stack', () => {
  const source = new URL('./monitoring-slo-preflight.mjs', import.meta.url);
  const run = spawnSync(process.execPath, [source.pathname, '--origin',
    'https://secret:password@prom.example.test/'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  const output = JSON.parse(run.stdout);
  assert.equal(output.status, 'BLOCKED');
  assert.deepEqual(output.reasons, ['INVALID_ARGUMENTS']);
  assert.ok(!run.stdout.includes('password'));
  assert.equal(run.stderr, '');
});
