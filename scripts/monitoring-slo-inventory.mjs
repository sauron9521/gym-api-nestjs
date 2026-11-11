import { randomBytes } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Operator-managed inventory, not discovered by this script. A separate
 * authoritative deployment system must update the input before each run.
 *
 * Target names mirror Prometheus HTTP scrape instance labels, NOT the
 * node_exporter instance label. Distinct textfile labels avoid collisions.
 */
export function parseSloInventory(text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).sort().join(',') !== 'deployments,scrapeIntervalSeconds,version' ||
      raw.version !== 1 || raw.scrapeIntervalSeconds !== 30 ||
      !Array.isArray(raw.deployments) || raw.deployments.length < 1 ||
      raw.deployments.length > 20) {
    throw new Error('Invalid SLO inventory manifest format or scrape interval');
  }

  const deployments = [];
  const names = new Set();
  let total = 0;
  for (const item of raw.deployments) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).sort().join(',') !== 'instances,name' ||
        typeof item.name !== 'string' ||
        !/^[a-z][a-z0-9_-]{0,39}$/.test(item.name) ||
        !Array.isArray(item.instances) || item.instances.length === 0 ||
        item.instances.length > 100 || names.has(item.name)) {
      throw new Error('Invalid or duplicate deployment in SLO inventory');
    }
    names.add(item.name);
    const instances = new Set();
    for (const target of item.instances) {
      if (typeof target !== 'string' || target.length > 128 ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]*:[1-9][0-9]{0,4}$/.test(target) ||
          instances.has(target)) {
        throw new Error('Invalid or duplicate expected target in SLO inventory');
      }
      instances.add(target);
    }
    total += instances.size;
    if (total > 200) throw new Error('Too many SLO inventory targets');
    deployments.push({ name: item.name, instances: [...instances].sort() });
  }
  return deployments.sort((a, b) => a.name.localeCompare(b.name));
}

/** Prometheus textfile exposition with fixed, strictly validated label values. */
export function renderSloInventory(deployments, timestampSeconds) {
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds < 0) {
    throw new Error('Invalid SLO inventory timestamp');
  }
  const lines = [
    '# HELP gym_api_slo_inventory_expected_target Expected per-process HTTP metrics scrape target from operator inventory.',
    '# TYPE gym_api_slo_inventory_expected_target gauge',
  ];
  for (const item of deployments) {
    for (const instance of item.instances) {
      lines.push(
        'gym_api_slo_inventory_expected_target{slo_deployment="' +
        item.name + '",target_instance="' + instance + '"} 1',
      );
    }
  }
  lines.push(
    '# HELP gym_api_slo_inventory_last_refresh_timestamp_seconds Last operator inventory regeneration timestamp.',
    '# TYPE gym_api_slo_inventory_last_refresh_timestamp_seconds gauge',
  );
  for (const item of deployments) {
    lines.push(
      'gym_api_slo_inventory_last_refresh_timestamp_seconds{slo_deployment="' +
      item.name + '"} ' + timestampSeconds,
    );
  }
  return lines.join('\n') + '\n';
}

/**
 * Fail closed on non-regular destination; atomically replace exporter textfile
 * with 0640 permissions. No private inventory details printed to stdout.
 */
export function writeSloInventory(file, text) {
  if (!file.endsWith('.prom')) throw new Error('Output must be a .prom file');
  if (existsSync(file) && !lstatSync(file).isFile()) {
    throw new Error('Refusing non-regular SLO inventory output');
  }
  const temporary = join(
    dirname(file), '.' + basename(file) + '.' + randomBytes(8).toString('hex') + '.tmp',
  );
  let handle;
  try {
    handle = openSync(temporary, 'wx', 0o640);
    writeFileSync(handle, text, 'utf8');
    fsyncSync(handle);
    closeSync(handle);
    handle = undefined;
    renameSync(temporary, file);
  } catch (error) {
    if (handle !== undefined) closeSync(handle);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function main(argv) {
  if (argv.length !== 4 || argv[0] !== '--input' ||
      argv[2] !== '--output' || !argv[1].endsWith('.json')) {
    throw new Error('Usage: node scripts/monitoring-slo-inventory.mjs --input inventory.json --output inventory.prom');
  }
  const raw = readFileSync(argv[1], 'utf8');
  if (raw.length > 65536) throw new Error('SLO inventory too large');
  const deployments = parseSloInventory(raw);
  const output = renderSloInventory(deployments, Math.floor(Date.now() / 1000));
  writeSloInventory(argv[3], output);
  process.stdout.write('SLO inventory textfile refreshed for ' +
    deployments.length + ' deployments.\n');
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write('SLO inventory generation failed: ' +
      (error instanceof Error ? error.message : 'unknown error') + '\n');
    process.exitCode = 1;
  }
}
