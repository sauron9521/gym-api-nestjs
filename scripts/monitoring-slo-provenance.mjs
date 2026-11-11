#!/usr/bin/env node
/**
 * Offline Ed25519 verifier for an independently issued SLO change approval.
 * Read-only "verify", protected local "record", or integrity-only "audit".
 * Never contacts ticket providers or activates production monitoring.
 */
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync,
  unlinkSync, writeSync,
} from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { verifyEvidenceBundle } from './monitoring-slo-rollout-evidence.mjs';
import { inventoryFingerprint } from './monitoring-slo-postrollout.mjs';

const DOMAIN = 'gym-api-slo-change-approval/v1';
const MAX_BYTES = 65_536;
const MAX_LEDGER_BYTES = 2_000_000;
const MAX_ROWS = 5000;
const FUTURE_SKEW_MS = 60_000;
const MAX_APPROVAL_LIFETIME_MS = 24 * 60 * 60 * 1000;
const HEX = /^[a-f0-9]{64}$/;
const NONCE = /^[a-f0-9]{32}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const DEPLOYMENT = /^[a-z][a-z0-9_-]{0,39}$/;
const FIELDS = [
  'version', 'domain', 'deployment', 'changeRef', 'evidenceSha256',
  'inventorySha256', 'approvedAt', 'expiresAt', 'nonce', 'signerKeyId',
];
const ENTRY_FIELDS = [
  'version', 'sequence', 'recordedAt', 'deployment', 'changeRef',
  'evidenceSha256', 'inventorySha256', 'approvalSha256', 'signerKeySha256',
  'nonce', 'previousHash', 'entryHash',
];

export class ProvenanceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProvenanceError';
    this.code = code;
  }
}

const exactKeys = (value, keys) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

const sha256 = value =>
  createHash('sha256').update(value).digest('hex');

const safeIso = value => {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value
    ? time : NaN;
};

function readSmall(path, maxSize = MAX_BYTES) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > maxSize) throw Error();
    return readFileSync(path, 'utf8');
  } catch {
    throw new ProvenanceError('INPUT_INVALID_OR_UNSAFE');
  }
}

function readJson(path) {
  try { return JSON.parse(readSmall(path)); }
  catch (err) {
    if (err instanceof ProvenanceError) throw err;
    throw new ProvenanceError('INPUT_INVALID_OR_UNSAFE');
  }
}

/** Exact canonical signed bytes, including a domain-separation header. */
export function approvalSigningBytes(approval) {
  if (!exactKeys(approval, FIELDS) ||
      approval.version !== 1 || approval.domain !== DOMAIN ||
      typeof approval.deployment !== 'string' ||
      !DEPLOYMENT.test(approval.deployment) ||
      typeof approval.changeRef !== 'string' ||
      !IDENTIFIER.test(approval.changeRef) ||
      typeof approval.signerKeyId !== 'string' ||
      !KEY_ID.test(approval.signerKeyId) ||
      typeof approval.evidenceSha256 !== 'string' ||
      typeof approval.inventorySha256 !== 'string' ||
      !HEX.test(approval.evidenceSha256) ||
      !HEX.test(approval.inventorySha256) ||
      typeof approval.nonce !== 'string' || !NONCE.test(approval.nonce)) {
    throw new ProvenanceError('APPROVAL_SCHEMA_INVALID');
  }
  return Buffer.from(DOMAIN + '\n' + JSON.stringify(
    Object.fromEntries(FIELDS.map(field => [field, approval[field]])),
  ), 'utf8');
}

export function verifySignedApproval({
  approval, signature, publicKeyPem, trustedKeySha256,
  evidence, inventory, nowMs = Date.now(),
}) {
  const bytes = approvalSigningBytes(approval);
  let bundle;
  try { bundle = verifyEvidenceBundle(evidence); }
  catch { throw new ProvenanceError('EVIDENCE_INVALID'); }
  if (approval.deployment !== bundle.deployment ||
      approval.changeRef !== evidence.review?.changeRef ||
      approval.evidenceSha256 !== bundle.digest) {
    throw new ProvenanceError('APPROVAL_EVIDENCE_MISMATCH');
  }
  let fingerprint;
  try { fingerprint = inventoryFingerprint(inventory, bundle.deployment); }
  catch { throw new ProvenanceError('INVENTORY_INVALID'); }
  if (fingerprint.count !== evidence.preflight.expectedReplicas ||
      fingerprint.sha256 !== approval.inventorySha256) {
    throw new ProvenanceError('APPROVAL_INVENTORY_MISMATCH');
  }
  const approved = safeIso(approval.approvedAt);
  const expires = safeIso(approval.expiresAt);
  const evidenceTime = safeIso(evidence.generatedAt);
  if (!Number.isFinite(approved) || !Number.isFinite(expires) ||
      !Number.isFinite(evidenceTime) || approved < evidenceTime ||
      approved > nowMs + FUTURE_SKEW_MS ||
      expires <= approved || expires - approved > MAX_APPROVAL_LIFETIME_MS ||
      nowMs >= expires) {
    throw new ProvenanceError('APPROVAL_EXPIRED_OR_INVALID_TIME');
  }
  if (typeof trustedKeySha256 !== 'string' || !HEX.test(trustedKeySha256)) {
    throw new ProvenanceError('TRUST_ANCHOR_INVALID');
  }
  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== 'ed25519') throw Error();
  } catch {
    throw new ProvenanceError('PUBLIC_KEY_INVALID');
  }
  const actualKeySha256 = sha256(publicKey.export({
    type: 'spki', format: 'der',
  }));
  if (actualKeySha256 !== trustedKeySha256) {
    throw new ProvenanceError('UNTRUSTED_PUBLIC_KEY');
  }
  // Reject malformed/noncanonical signatures before touching crypto.verify.
  if (typeof signature !== 'string' ||
      !/^[A-Za-z0-9_-]{86}$/.test(signature)) {
    throw new ProvenanceError('SIGNATURE_INVALID');
  }
  const decoded = Buffer.from(signature, 'base64url');
  if (decoded.length !== 64 || decoded.toString('base64url') !== signature ||
      !verifySignature(null, bytes, publicKey, decoded)) {
    throw new ProvenanceError('SIGNATURE_INVALID');
  }
  return {
    version: 1,
    status: 'SIGNED_APPROVAL_VERIFIED_FOR_HUMAN_REVIEW',
    deployment: bundle.deployment,
    changeRef: approval.changeRef,
    evidenceSha256: bundle.digest,
    inventorySha256: fingerprint.sha256,
    approvalSha256: sha256(bytes),
    signerKeySha256: actualKeySha256,
    nonce: approval.nonce,
    expiresAt: approval.expiresAt,
    signerKeyId: approval.signerKeyId,
    authenticatedSignature: true,
    externalTicketStateChecked: false,
    productionAuthorized: false,
  };
}

function entryHash(entry) {
  const data = Object.fromEntries(ENTRY_FIELDS.filter(field =>
    field !== 'entryHash').map(field => [field, entry[field]]));
  return sha256(JSON.stringify(data));
}

/** Local audit chain integrity ONLY. An external anchor is still required. */
export function verifyLedger(contents) {
  if (typeof contents !== 'string' ||
      Buffer.byteLength(contents) > MAX_LEDGER_BYTES ||
      (contents !== '' && !contents.endsWith('\n'))) {
    throw new ProvenanceError('LEDGER_CORRUPT');
  }
  const lines = contents ? contents.trimEnd().split('\n') : [];
  if (lines.length > MAX_ROWS) throw new ProvenanceError('LEDGER_CORRUPT');
  const approvals = new Set();
  const changes = new Set();
  const evidences = new Set();
  const nonces = new Set();
  let previous = '0'.repeat(64);
  for (let i = 0; i < lines.length; i++) {
    let row;
    try { row = JSON.parse(lines[i]); }
    catch { throw new ProvenanceError('LEDGER_CORRUPT'); }
    if (!exactKeys(row, ENTRY_FIELDS) || row.version !== 1 ||
        row.sequence !== i + 1 || row.previousHash !== previous ||
        typeof row.entryHash !== 'string' || !HEX.test(row.entryHash) ||
        typeof row.approvalSha256 !== 'string' || !HEX.test(row.approvalSha256) ||
        typeof row.evidenceSha256 !== 'string' || !HEX.test(row.evidenceSha256) ||
        typeof row.inventorySha256 !== 'string' || !HEX.test(row.inventorySha256) ||
        typeof row.signerKeySha256 !== 'string' || !HEX.test(row.signerKeySha256) ||
        typeof row.nonce !== 'string' || !NONCE.test(row.nonce) ||
        typeof row.changeRef !== 'string' || !IDENTIFIER.test(row.changeRef) ||
        typeof row.deployment !== 'string' || !DEPLOYMENT.test(row.deployment) ||
        !Number.isFinite(safeIso(row.recordedAt)) ||
        row.entryHash !== entryHash(row)) {
      throw new ProvenanceError('LEDGER_CORRUPT');
    }
    const ticket = row.deployment + ':' + row.changeRef;
    if (approvals.has(row.approvalSha256) || changes.has(ticket) ||
        evidences.has(row.evidenceSha256) || nonces.has(row.nonce)) {
      throw new ProvenanceError('LEDGER_REPLAY_DETECTED');
    }
    approvals.add(row.approvalSha256);
    changes.add(ticket);
    evidences.add(row.evidenceSha256);
    nonces.add(row.nonce);
    previous = row.entryHash;
  }
  return {rows: lines.length, headSha256: previous,
    approvals, changes, evidences, nonces};
}

function loadLedger(file) {
  if (!existsSync(file)) return verifyLedger('');
  return verifyLedger(readSmall(file, MAX_LEDGER_BYTES));
}

export function assertNotPreviouslyRecorded(verified, ledger) {
  const ticket = verified.deployment + ':' + verified.changeRef;
  if (ledger.approvals.has(verified.approvalSha256) ||
      ledger.changes.has(ticket) ||
      ledger.evidences.has(verified.evidenceSha256) ||
      ledger.nonces.has(verified.nonce)) {
    throw new ProvenanceError('APPROVAL_REPLAY_DETECTED');
  }
}

/**
 * An exclusive .lock prevents CONCURRENT cooperating writers. A crash may
 * leave the lock in place: fail closed; operator must investigate before
 * manual removal. Never discard a ledger or stale lock automatically.
 */
export function recordVerifiedApproval(file, verified, nowMs = Date.now()) {
  if (!isAbsolute(file) || !file.endsWith('.jsonl')) {
    throw new ProvenanceError('LEDGER_PATH_INVALID');
  }
  const lockPath = file + '.lock';
  let lock;
  let destination;
  try {
    lock = openSync(lockPath, 'wx', 0o600);
  } catch {
    throw new ProvenanceError('LEDGER_LOCKED');
  }
  try {
    const prior = loadLedger(file);
    assertNotPreviouslyRecorded(verified, prior);
    if (prior.rows >= MAX_ROWS) throw new ProvenanceError('LEDGER_FULL');
    const row = {
      version: 1, sequence: prior.rows + 1,
      recordedAt: new Date(nowMs).toISOString(),
      deployment: verified.deployment,
      changeRef: verified.changeRef,
      evidenceSha256: verified.evidenceSha256,
      inventorySha256: verified.inventorySha256,
      approvalSha256: verified.approvalSha256,
      signerKeySha256: verified.signerKeySha256,
      nonce: verified.nonce,
      previousHash: prior.headSha256,
    };
    const line = JSON.stringify({...row, entryHash: entryHash(row)}) + '\n';
    const beforeBytes = existsSync(file) ? lstatSync(file).size : 0;
    if (beforeBytes + Buffer.byteLength(line) > MAX_LEDGER_BYTES) {
      throw new ProvenanceError('LEDGER_FULL');
    }
    // O_NOFOLLOW protects against symlink substitution on supported systems.
    // openSync('ax') is O_APPEND | O_CREAT | O_EXCL; only for new files.
    // Existing files require O_APPEND without O_EXCL.
    destination = openSync(file, existsSync(file) ? 'a' : 'ax', 0o600);
    writeSync(destination, line);
    fsyncSync(destination);
    closeSync(destination);
    destination = undefined;
    return {rows: row.sequence, headSha256: entryHash(row)};
  } catch (err) {
    if (err instanceof ProvenanceError) throw err;
    throw new ProvenanceError('LEDGER_WRITE_FAILED');
  } finally {
    if (destination !== undefined) closeSync(destination);
    if (lock !== undefined) closeSync(lock);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}

export function parseProvenanceArgs(args) {
  if (args.length === 4 && args[0] === '--mode' &&
      args[1] === 'audit' && args[2] === '--ledger' &&
      isAbsolute(args[3])) {
    return {mode: 'audit', ledger: args[3]};
  }
  const permitted = ['--mode','--evidence','--inventory','--approval',
    '--signature','--public-key','--trusted-key-sha256','--ledger'];
  if (args.length !== permitted.length * 2) throw new ProvenanceError('INVALID_ARGUMENTS');
  const parsed = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], val = args[i + 1];
    if (!permitted.includes(flag) || parsed.has(flag) ||
        typeof val !== 'string' || !val) throw new ProvenanceError('INVALID_ARGUMENTS');
    parsed.set(flag, val);
  }
  if (parsed.size !== permitted.length ||
      !['verify','record'].includes(parsed.get('--mode')) ||
      !HEX.test(parsed.get('--trusted-key-sha256')) ||
      permitted.filter(x => !['--mode','--trusted-key-sha256'].includes(x))
        .some(x => !isAbsolute(parsed.get(x))) ||
      new Set(permitted.filter(x => !['--mode','--trusted-key-sha256'].includes(x))
        .map(x => parsed.get(x))).size !== 6) {
    throw new ProvenanceError('INVALID_ARGUMENTS');
  }
  return Object.fromEntries([...parsed].map(([key,val]) => [
    {
      '--mode':'mode', '--evidence':'evidence', '--inventory':'inventory',
      '--approval':'approval', '--signature':'signature',
      '--public-key':'publicKey', '--trusted-key-sha256':'trustedKeySha256',
      '--ledger':'ledger',
    }[key], val,
  ]));
}

function resultSummary(verified) {
  return {
    status: verified.status, deployment: verified.deployment,
    changeRef: verified.changeRef, approvalSha256: verified.approvalSha256,
    signerKeySha256: verified.signerKeySha256,
    authenticatedSignature: true, externalTicketStateChecked: false,
    productionAuthorized: false,
  };
}

async function main(args) {
  try {
    const opts = parseProvenanceArgs(args);
    if (opts.mode === 'audit') {
      if (!opts.ledger.endsWith('.jsonl')) throw new ProvenanceError('LEDGER_PATH_INVALID');
      if (!existsSync(opts.ledger)) throw new ProvenanceError('LEDGER_MISSING');
      const state = loadLedger(opts.ledger);
      process.stdout.write(JSON.stringify({
        status: 'LOCAL_HASH_CHAIN_INTACT', entries: state.rows,
        headSha256: state.headSha256, externallyAnchored: false,
      }) + '\n');
      return;
    }
    const verified = verifySignedApproval({
      approval: readJson(opts.approval),
      signature: readSmall(opts.signature, 1024).trim(),
      publicKeyPem: readSmall(opts.publicKey, 8192),
      trustedKeySha256: opts.trustedKeySha256,
      evidence: readJson(opts.evidence), inventory: readJson(opts.inventory),
    });
    if (!opts.ledger.endsWith('.jsonl')) throw new ProvenanceError('LEDGER_PATH_INVALID');
    if (opts.mode === 'verify') {
      const ledger = loadLedger(opts.ledger);
      assertNotPreviouslyRecorded(verified, ledger);
      process.stdout.write(JSON.stringify(resultSummary(verified)) + '\n');
      return;
    }
    const entry = recordVerifiedApproval(opts.ledger, verified);
    process.stdout.write(JSON.stringify({
      ...resultSummary(verified),
      status: 'SIGNED_APPROVAL_RECORDED_FOR_HUMAN_REVIEW',
      ledgerRows: entry.rows, ledgerHeadSha256: entry.headSha256,
    }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({
      status: 'BLOCKED',
      reasons: [error instanceof ProvenanceError ?
        error.code : 'PROVENANCE_FAILED'],
    }) + '\n');
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
