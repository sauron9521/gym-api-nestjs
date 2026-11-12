import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseReceiptArgs, receiptRecord } from './monitoring-alert-receipt.mjs';

const script = fileURLToPath(new URL('./monitoring-alert-receipt.mjs', import.meta.url));
const id = '70b8db83-12e4-40d5-9b65-2f7c8f5b2d11';

test('receipt acknowledgement must be explicit and sanitized', () => {
  const input = ['--drill-id', id, '--channel', 'pager', '--acknowledge-received'];
  assert.deepEqual(parseReceiptArgs(input), { drillId: id, channel: 'pager' });
  for (const invalid of [
    ['--drill-id', id, '--channel', 'pager'],
    ['--drill-id', 'not-uuid', '--channel', 'pager', '--acknowledge-received'],
    ['--drill-id', id, '--channel', 'other', '--acknowledge-received'],
    ['--drill-id', id, '--channel', 'email@example.test', '--acknowledge-received'],
  ]) assert.throws(() => parseReceiptArgs(invalid));
  assert.deepEqual(receiptRecord({ drillId: id, channel: 'pager' },
    '2026-11-12T00:00:00.000Z'), {
    drillId: id, channel: 'pager',
    acknowledgedAt: '2026-11-12T00:00:00.000Z',
    notificationConfirmed: true,
    confirmationSource: 'operator-attestation',
    independentDeliveryProof: false,
  });
});

test('receipt CLI refuses missing confirmation and never calls a provider', () => {
  const no = spawnSync(process.execPath, [script, '--drill-id', id], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(no.status, 1);
  const ok = spawnSync(process.execPath, [script,
    '--drill-id', id, '--channel', 'email', '--acknowledge-received'], {
      encoding: 'utf8', timeout: 5000,
    });
  assert.equal(ok.status, 0, ok.stderr);
  const obj = JSON.parse(ok.stdout);
  assert.equal(obj.independentDeliveryProof, false);
  assert.equal(obj.confirmationSource, 'operator-attestation');
});
