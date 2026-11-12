#!/usr/bin/env node
// Opt-in host-side backup monitoring. No DB credentials or Docker socket.
import { spawnSync } from 'node:child_process';
import { isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { writeMetricsFile } from './monitoring-textfile.mjs';

const script = fileURLToPath(new URL('./verify-backup-freshness.sh', import.meta.url));

export function parseBackupHealthConfig(env) {
  const root = env.BACKUP_ROOT;
  const output = env.BACKUP_TEXTFILE_PATH;
  const ageHours = env.BACKUP_MAX_AGE_HOURS ?? '26';
  if (typeof root !== 'string' || !isAbsolute(root) || root.includes('\n') ||
      typeof output !== 'string' || !isAbsolute(output) ||
      basename(output) !== 'gym_api_backup.prom' ||
      !/^[0-9]{1,3}$/.test(ageHours)) {
    throw new Error('Invalid backup health configuration');
  }
  const hours = Number(ageHours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    throw new Error('Invalid backup health age limit');
  }
  return { root, output, ageHours: String(hours) };
}

export function renderBackupHealthMetrics(healthy, timestamp) {
  if (typeof healthy !== 'boolean' ||
      !Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('Invalid backup health sample');
  }
  // Fixed unlabeled metrics. Never expose archive names, paths or credentials.
  return [
    '# HELP gym_api_backup_last_check_timestamp_seconds Last backup verification attempt in Unix seconds',
    '# TYPE gym_api_backup_last_check_timestamp_seconds gauge',
    'gym_api_backup_last_check_timestamp_seconds ' + timestamp,
    '# HELP gym_api_backup_verified Latest backup passed freshness, checksum and archive checks',
    '# TYPE gym_api_backup_verified gauge',
    'gym_api_backup_verified ' + Number(healthy),
    '',
  ].join('\n');
}

export function verifyBackup(root, ageHours) {
  try {
    const result = spawnSync('bash', [script, root], {
      env: { ...process.env, BACKUP_MAX_AGE_HOURS: ageHours },
      timeout: 30_000,
      stdio: 'ignore',
      windowsHide: true,
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

export async function collectBackupHealth(
  env = process.env,
  nowSeconds = Math.floor(Date.now() / 1000),
  verify = verifyBackup,
  publish = writeMetricsFile,
) {
  const { root, output, ageHours } = parseBackupHealthConfig(env);
  const healthy = Boolean(await verify(root, ageHours));
  await publish(output, renderBackupHealthMetrics(healthy, nowSeconds));
  return { published: true, verified: healthy };
}

async function main() {
  try {
    const result = await collectBackupHealth();
    if (!result.verified) {
      process.stderr.write('Backup verification failed; unhealthy metrics published\n');
      process.exitCode = 1;
    }
  } catch {
    process.stderr.write('Backup monitoring failed; no new metrics published\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
