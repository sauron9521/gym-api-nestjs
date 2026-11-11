import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  parseSloInventory, renderSloInventory, writeSloInventory,
} from './monitoring-slo-inventory.mjs';

const demo = {
  version: 1, scrapeIntervalSeconds: 30,
  deployments: [
    { name: 'staging', instances: ['stage-b:8443', 'stage-a:8443'] },
    { name: 'production', instances: ['prod-b:8443', 'prod-a:8443'] },
  ],
};

test('generates reproducible fixed-label expected targets and freshness for each deployment', () => {
  const input = parseSloInventory(JSON.stringify(demo));
  assert.deepEqual(input.map(x => x.name), ['production', 'staging']);
  assert.deepEqual(input[0].instances, ['prod-a:8443', 'prod-b:8443']);
  const output = renderSloInventory(input, 1794000000);
  assert.equal((output.match(/^gym_api_slo_inventory_expected_target{/gm) || []).length, 4);
  assert.equal((output.match(/^gym_api_slo_inventory_last_refresh_timestamp_seconds{/gm) || []).length, 2);
  assert.match(output, /slo_deployment="production",target_instance="prod-a:8443"/);
  assert.match(output, /slo_deployment="staging",target_instance="stage-b:8443"/);
  assert.match(output, /gym_api_slo_inventory_last_refresh_timestamp_seconds\{slo_deployment="production"\} 1794000000/);
  assert.doesNotMatch(output, /\bBearer\b|password|token|email|https?:\/\//i);
  assert.equal(renderSloInventory(input, 1794000000), output);
});

test('rejects unsupported scrape cadence, collisions, injection and empty inventory', () => {
  const variants = [
    { ...demo, version: 2 },
    { ...demo, scrapeIntervalSeconds: 60 },
    { ...demo, deployments: [] },
    { ...demo, extra: 'value' },
    { ...demo, deployments: [{name:'production', instances:[]}] },
    { ...demo, deployments: [{name:'production', instances:['prod-a:8443','prod-a:8443']}] },
    { ...demo, deployments: [{name:'production', instances:['prod-a:8443']}, {name:'production', instances:['prod-b:8443']}] },
    { ...demo, deployments: [{name:'production', instances:['api-a:8443', 'bad"label:443']}] },
    { ...demo, deployments: [{name:'production', instances:['/internal/metrics']}] },
    { ...demo, deployments: [{name:'production;delete', instances:['api-a:443']}] },
    { ...demo, deployments: [{name:'production', instances:['api-a:443'], accessToken:'SECRET'}] },
    { ...demo, deployments: [{name:'production', instances:['api-a:443'], requestId:'123'}] },
  ];
  for (const v of variants) assert.throws(() => parseSloInventory(JSON.stringify(v)));
  assert.throws(() => parseSloInventory('{ this is not JSON }'));
  assert.throws(() => renderSloInventory([], NaN));
});

test('writes atomic restrictive .prom files and rejects symlink destinations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gym-api-inventory-'));
  try {
    const output = join(dir, 'inventory.prom');
    writeSloInventory(output, renderSloInventory(parseSloInventory(JSON.stringify(demo)), 100));
    assert.match(readFileSync(output, 'utf8'), /} 100/);
    if (process.platform !== 'win32') {
      assert.equal(statSync(output).mode & 0o777, 0o640);
    }
    writeSloInventory(output, renderSloInventory(parseSloInventory(JSON.stringify(demo)), 200));
    const content = readFileSync(output, 'utf8');
    assert.match(content, /} 200/);
    assert.doesNotMatch(content, /} 100/);
    assert.throws(() => writeSloInventory(join(dir, 'not-prom.txt'), content));
    const symbolic = join(dir, 'inventory-symlink.prom');
    symlinkSync(output, symbolic);
    assert.throws(() => writeSloInventory(symbolic, content), /non-regular/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI reads external manifest and does not log targets or credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gym-api-slo-cli-'));
  try {
    const input = join(dir, 'targets.json');
    const output = join(dir, 'targets.prom');
    writeFileSync(input, JSON.stringify(demo));
    const stdout = execFileSync(
      process.execPath, [
        new URL('./monitoring-slo-inventory.mjs', import.meta.url).pathname,
        '--input', input, '--output', output,
      ], { encoding: 'utf8' },
    );
    assert.match(stdout, /2 deployments/);
    assert.doesNotMatch(stdout, /prod-a|stage-b|Bearer|token/i);
    assert.match(readFileSync(output, 'utf8'), /gym_api_slo_inventory_expected_target/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
