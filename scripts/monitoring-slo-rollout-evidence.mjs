#!/usr/bin/env node
/**
 * Offline, operator-attested, tamper-evident (NOT cryptographically signed)
 * SLO rollout evidence. No network, Docker, shell, Alertmanager or deployment.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, linkSync, lstatSync, openSync,
  readFileSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PREFLIGHT_METRICS } from './monitoring-slo-preflight.mjs';

const MAX_INPUT_BYTES = 65_536;
const MAX_AGE_MS = 10 * 60_000;
const FUTURE_SKEW_MS = 60_000;
const DEPLOYMENT_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
// Change references are local ticket IDs, never URLs, paths or credentials.
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/;
const METRIC_KEYS = Object.freeze(PREFLIGHT_METRICS.map(x => x.split(':').at(-1)));
const BOOLEAN_KEYS = new Set(METRIC_KEYS.filter(x =>
  !x.includes('coverage') && !x.includes('scrape_success') &&
  !x.includes('availability_verified') && !x.includes('error_budget_consumed')));
const FRACTION_KEYS = new Set(METRIC_KEYS.filter(x =>
  x.includes('coverage') || x.includes('scrape_success') ||
  x.includes('availability_verified')));
export const REQUIRED_CONFIRMATIONS = Object.freeze([
  'independentInventoryReviewed',
  'perReplicaScrapeAndHistoryReviewed',
  'secretsAndAccessReviewed',
  'testAlertRoutingReviewed',
  'rollbackProcedureReviewed',
]);

export class EvidenceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'EvidenceError';
    this.code = code;
  }
}

function exactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function validInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return NaN;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ?
    parsed : NaN;
}

function near(nowMs, instant, maxAge = MAX_AGE_MS) {
  return Number.isFinite(instant) &&
    instant - nowMs <= FUTURE_SKEW_MS && nowMs - instant <= maxAge;
}

export function validatePreflightEvidence(input, nowMs = Date.now()) {
  const expected = [
    'version', 'checkedAt', 'deployment', 'status', 'expectedReplicas',
    'observedReplicas', 'checks', 'reasons',
  ];
  if (!exactKeys(input, expected) || input.version !== 1 ||
      input.status !== 'READY_FOR_REVIEW' ||
      !DEPLOYMENT_RE.test(input.deployment) ||
      !Number.isSafeInteger(input.expectedReplicas) ||
      input.expectedReplicas < 1 || input.expectedReplicas > 200 ||
      input.observedReplicas !== input.expectedReplicas ||
      !Array.isArray(input.reasons) || input.reasons.length !== 0 ||
      !near(nowMs, validInstant(input.checkedAt))) {
    throw new EvidenceError('PREFLIGHT_NOT_READY_OR_STALE');
  }
  if (!exactKeys(input.checks, METRIC_KEYS)) {
    throw new EvidenceError('PREFLIGHT_CHECKS_INCOMPLETE');
  }
  for (const name of METRIC_KEYS) {
    const value = input.checks[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new EvidenceError('PREFLIGHT_CHECKS_INVALID');
    }
    if (BOOLEAN_KEYS.has(name) && value !== 1) {
      throw new EvidenceError('PREFLIGHT_CHECKS_NOT_READY');
    }
    if (FRACTION_KEYS.has(name) && (value < 0.99 || value > 1)) {
      // Availability is a measured SLI, not an eligibility check. It may be
      // below 99.9% and still be valid evidence of a real incident.
      if (name !== 'http_availability_verified_30d' || value < 0 || value > 1) {
        throw new EvidenceError('PREFLIGHT_COVERAGE_INSUFFICIENT');
      }
    }
    if (name === 'http_error_budget_consumed_verified_30d' && value < 0) {
      throw new EvidenceError('PREFLIGHT_CHECKS_INVALID');
    }
  }
  return {
    version: 1, checkedAt: input.checkedAt, deployment: input.deployment,
    status: 'READY_FOR_REVIEW',
    expectedReplicas: input.expectedReplicas,
    observedReplicas: input.observedReplicas,
    checks: Object.fromEntries(METRIC_KEYS.map(key => [key, input.checks[key]])),
    reasons: [],
  };
}

export function validateOperatorChecklist(input, report, nowMs = Date.now()) {
  if (!exactKeys(input, [
    'version', 'deployment', 'reviewer', 'reviewedAt', 'changeRef',
    'decision', 'confirmations',
  ]) || input.version !== 1 || input.deployment !== report.deployment ||
      input.decision !== 'REVIEWED_FOR_STAGING' ||
      !ALIAS_RE.test(input.reviewer) || !REF_RE.test(input.changeRef) ||
      !near(nowMs, validInstant(input.reviewedAt)) ||
      validInstant(input.reviewedAt) < validInstant(report.checkedAt) ||
      !exactKeys(input.confirmations, REQUIRED_CONFIRMATIONS) ||
      REQUIRED_CONFIRMATIONS.some(key => input.confirmations[key] !== true)) {
    throw new EvidenceError('OPERATOR_REVIEW_INCOMPLETE');
  }
  return {
    version: 1, deployment: report.deployment, reviewer: input.reviewer,
    reviewedAt: input.reviewedAt, changeRef: input.changeRef,
    decision: 'REVIEWED_FOR_STAGING',
    confirmations: Object.fromEntries(REQUIRED_CONFIRMATIONS.map(x => [x, true])),
  };
}

export function createEvidenceBundle(reportInput, reviewInput, nowMs = Date.now()) {
  const report = validatePreflightEvidence(reportInput, nowMs);
  const review = validateOperatorChecklist(reviewInput, report, nowMs);
  return {
    version: 1,
    generatedAt: new Date(nowMs).toISOString(),
    deployment: report.deployment,
    status: 'EVIDENCE_READY_FOR_HUMAN_REVIEW',
    preflight: report,
    review,
    hashes: {
      preflightSha256: sha256(report),
      reviewSha256: sha256(review),
    },
    safeguards: {
      networkCalls: false,
      productionAlertsEnabled: false,
      deploymentExecuted: false,
      cryptographicallySigned: false,
    },
  };
}

/**
 * Integrity check detects modifications to included report/review after
 * packaging. It does NOT establish reviewer identity or independent source
 * authenticity: SHA-256 with no external signature is not an attestation.
 */
export function verifyEvidenceBundle(bundle) {
  try {
    if (!exactKeys(bundle, [
      'version', 'generatedAt', 'deployment', 'status', 'preflight',
      'review', 'hashes', 'safeguards',
    ]) || bundle.version !== 1 ||
        bundle.status !== 'EVIDENCE_READY_FOR_HUMAN_REVIEW' ||
        !exactKeys(bundle.hashes, ['preflightSha256', 'reviewSha256']) ||
        !exactKeys(bundle.safeguards, [
          'networkCalls', 'productionAlertsEnabled', 'deploymentExecuted',
          'cryptographicallySigned',
        ]) ||
        Object.values(bundle.safeguards).some(value => value !== false)) {
      throw new EvidenceError('EVIDENCE_INVALID');
    }
    const generatedAt = validInstant(bundle.generatedAt);
    if (!Number.isFinite(generatedAt) ||
        bundle.deployment !== bundle.preflight?.deployment ||
        bundle.deployment !== bundle.review?.deployment) {
      throw new EvidenceError('EVIDENCE_INVALID');
    }
    const report = validatePreflightEvidence(bundle.preflight, generatedAt);
    const review = validateOperatorChecklist(bundle.review, report, generatedAt);
    if (bundle.hashes.preflightSha256 !== sha256(report) ||
        bundle.hashes.reviewSha256 !== sha256(review)) {
      throw new EvidenceError('EVIDENCE_HASH_MISMATCH');
    }
    return { valid: true, digest: sha256(bundle), deployment: bundle.deployment };
  } catch (error) {
    if (error instanceof EvidenceError) throw error;
    throw new EvidenceError('EVIDENCE_INVALID');
  }
}

export function parseEvidenceArgs(argv) {
  if (argv.length === 2 && argv[0] === '--verify') {
    if (!isAbsolute(argv[1])) throw new EvidenceError('INVALID_ARGUMENTS');
    return { verifyPath: argv[1] };
  }
  if (argv.length !== 6) throw new EvidenceError('INVALID_ARGUMENTS');
  const args = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--report', '--checklist', '--output'].includes(key) ||
        args.has(key) || !isAbsolute(argv[i + 1])) {
      throw new EvidenceError('INVALID_ARGUMENTS');
    }
    args.set(key, argv[i + 1]);
  }
  if (args.size !== 3 || !args.get('--output').endsWith('.json') ||
      new Set(args.values()).size !== 3) {
    throw new EvidenceError('INVALID_ARGUMENTS');
  }
  return {
    reportPath: args.get('--report'),
    reviewPath: args.get('--checklist'),
    outputPath: args.get('--output'),
  };
}

function readSmallRegularJson(path) {
  let parsed;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw Error();
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new EvidenceError('INPUT_INVALID_OR_UNSAFE');
  }
  return parsed;
}

/** Safe, exclusive creation: hard-link temp file, never replace old evidence. */
export function writeEvidenceBundle(outputPath, bundle) {
  if (!isAbsolute(outputPath) || !outputPath.endsWith('.json') ||
      existsSync(outputPath)) throw new EvidenceError('OUTPUT_EXISTS_OR_UNSAFE');
  const temp = join(dirname(outputPath),
    '.' + basename(outputPath) + '.' + randomBytes(8).toString('hex') + '.tmp');
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    // Same-directory hard link is atomic and never overwrites an old artifact.
    linkSync(temp, outputPath);
  } catch {
    throw new EvidenceError('OUTPUT_WRITE_FAILED');
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

async function main(argv) {
  try {
    const options = parseEvidenceArgs(argv);
    if (options.verifyPath) {
      const valid = verifyEvidenceBundle(readSmallRegularJson(options.verifyPath));
      process.stdout.write(JSON.stringify({
        status: 'EVIDENCE_VALID', deployment: valid.deployment,
        sha256: valid.digest, authenticatedSignature: false,
      }) + '\n');
      return;
    }
    const evidence = createEvidenceBundle(
      readSmallRegularJson(options.reportPath),
      readSmallRegularJson(options.reviewPath),
    );
    writeEvidenceBundle(options.outputPath, evidence);
    process.stdout.write(JSON.stringify({
      status: evidence.status, deployment: evidence.deployment,
      sha256: sha256(evidence), authenticatedSignature: false,
    }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({
      status: 'BLOCKED', reasons: [
        error instanceof EvidenceError ? error.code : 'EVIDENCE_FAILED',
      ],
    }) + '\n');
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
