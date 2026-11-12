import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  collectBackupHealth, parseBackupHealthConfig, renderBackupHealthMetrics,
} from './monitoring-backup-health.mjs';

const config = {
  BACKUP_ROOT: '/srv/private/gym-backups',
  BACKUP_TEXTFILE_PATH: '/var/lib/node_exporter/textfile_collector/gym_api_backup.prom',
  BACKUP_MAX_AGE_HOURS: '26',
};

test('requires safe absolute monitoring paths and bounded backup age', () => {
  assert.deepEqual(parseBackupHealthConfig(config), {
    root: config.BACKUP_ROOT,
    output: config.BACKUP_TEXTFILE_PATH,
    ageHours: '26',
  });
  for (const invalid of [
    { BACKUP_ROOT: 'relative/backups' },
    { BACKUP_ROOT: '/tmp/foo\nbar' },
    { BACKUP_TEXTFILE_PATH: '../gym_api_backup.prom' },
    { BACKUP_TEXTFILE_PATH: '/tmp/other.prom' },
    { BACKUP_MAX_AGE_HOURS: '0' },
    { BACKUP_MAX_AGE_HOURS: '169' },
    { BACKUP_MAX_AGE_HOURS: '-1' },
    { BACKUP_MAX_AGE_HOURS: '1;exit' },
  ]) {
    assert.throws(() => parseBackupHealthConfig({ ...config, ...invalid }));
  }
});

test('publishes fixed numeric metrics without any private path', () => {
  const text = renderBackupHealthMetrics(false, 1_800_000_000);
  assert.match(text, /gym_api_backup_verified 0\n/);
  assert.match(text, /gym_api_backup_last_check_timestamp_seconds 1800000000/);
  assert.doesNotMatch(text, /srv|tmp|postgres|token|password|email/i);
  assert.throws(() => renderBackupHealthMetrics('healthy', -1));
});

test('healthy check publishes a successful snapshot', async () => {
  const calls = [];
  const result = await collectBackupHealth(config, 1_800_000_000,
    async (root, hours) => {
      assert.equal(root, config.BACKUP_ROOT);
      assert.equal(hours, '26');
      return true;
    }, async (output, data) => calls.push({ output, data }));
  assert.deepEqual(result, { published: true, verified: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].output, config.BACKUP_TEXTFILE_PATH);
  assert.match(calls[0].data, /gym_api_backup_verified 1\n/);
});

test('failed verification publishes an unhealthy snapshot, not a false success', async () => {
  let saved = '';
  const result = await collectBackupHealth(config, 1_800_000_020,
    () => false, async (_, data) => { saved = data; });
  assert.deepEqual(result, { published: true, verified: false });
  assert.match(saved, /gym_api_backup_verified 0\n/);
});

test('publication errors fail closed rather than reporting a verified backup', async () => {
  await assert.rejects(collectBackupHealth(config, 1_800_000_000,
    () => true, () => { throw new Error('write failed'); }), /write failed/);
  await assert.rejects(collectBackupHealth({ ...config, BACKUP_ROOT: '' },
    1_800_000_000, () => { throw new Error('should not run'); }));
});
