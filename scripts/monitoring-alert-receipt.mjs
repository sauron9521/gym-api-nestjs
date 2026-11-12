#!/usr/bin/env node
// Pure operator-attested receipt record; cannot independently verify delivery.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHANNELS = new Set(['email', 'sms', 'pager', 'chat', 'webhook']);

export function parseReceiptArgs(args) {
  if (args.length !== 5 || args[0] !== '--drill-id' ||
      args[2] !== '--channel' || args[4] !== '--acknowledge-received' ||
      !UUID.test(args[1] ?? '') || !CHANNELS.has(args[3])) {
    throw new Error('Receipt needs drill ID, supported channel and explicit acknowledgement');
  }
  return { drillId: args[1], channel: args[3] };
}

export function receiptRecord(data, isoTime = new Date().toISOString()) {
  if (!UUID.test(data?.drillId ?? '') || !CHANNELS.has(data?.channel) ||
      !Number.isFinite(Date.parse(isoTime))) {
    throw new Error('Invalid operator receipt evidence');
  }
  return {
    drillId: data.drillId,
    channel: data.channel,
    acknowledgedAt: isoTime,
    notificationConfirmed: true,
    confirmationSource: 'operator-attestation',
    independentDeliveryProof: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const record = receiptRecord(parseReceiptArgs(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(record) + '\n');
  } catch {
    process.stderr.write('Invalid or missing operator delivery receipt acknowledgement\n');
    process.exitCode = 1;
  }
}
