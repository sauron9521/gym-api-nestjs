#!/usr/bin/env node
/**
 * Offline post-rollout drift report from previously archived SLO evidence
 * and two independently maintained target inventories.
 * No network requests, mutations, shell, Docker or notification delivery.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import { verifyEvidenceBundle, validatePreflightEvidence } from './monitoring-slo-rollout-evidence.mjs';
import { parseSloInventory } from './monitoring-slo-inventory.mjs';

const INPUT_LIMIT = 65_536;
const REPORT_MAX_AGE_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 60_000;
const CHANGE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SLO_DROP_THRESHOLD = 0.001; // 0.1 percentage point
const BUDGET_INCREASE_THRESHOLD = 0.5; // 50% of provisional allowance

export class DriftError extends Error {
  constructor(code) {
    super(code);
    this.name = 'DriftError';
    this.code = code;
  }
}

const exactKeys = (value, keys) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function parsedIso(iso) {
  if (typeof iso !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso)) return NaN;
  const time = Date.parse(iso);
  return Number.isFinite(time) && new Date(time).toISOString() === iso ? time : NaN;
}

function digest(input) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function selectDeployment(inventory, deployment) {
  let deployments;
  try { deployments = parseSloInventory(JSON.stringify(inventory)); }
  catch { throw new DriftError('INVENTORY_INVALID'); }
  const selection = deployments.find(item => item.name === deployment);
  if (!selection) throw new DriftError('DEPLOYMENT_NOT_IN_INVENTORY');
  return selection;
}

/**
 * Canonicalize a single deployment inventory, without exporting any instance
 * identifiers to the resulting user-visible drift report.
 */
export function inventoryFingerprint(inventory, deployment) {
  const selected = selectDeployment(inventory, deployment);
  return {
    count: selected.instances.length,
    sha256: digest({version: 1, deployment, instances: selected.instances}),
  };
}

/**
 * A separate operator-exported change record can be cross-checked, but no
 * self-provided JSON can prove external authorization or signer identity.
 */
export function validateChangeRecord(record, evidence, baselineInventorySha256,
  nowMs = Date.now()) {
  if (!exactKeys(record, [
    'version', 'changeRef', 'evidenceSha256', 'inventorySha256',
    'recordedAt', 'decision', 'operatorVerifiedExternally',
  ]) || record.version !== 1 ||
      typeof record.changeRef !== 'string' ||
      !CHANGE_REF.test(record.changeRef) ||
      record.changeRef !== evidence.review?.changeRef ||
      record.decision !== 'STAGING_ROLLOUT_REVIEWED' ||
      record.operatorVerifiedExternally !== true ||
      typeof record.evidenceSha256 !== 'string' ||
      typeof record.inventorySha256 !== 'string' ||
      !DIGEST.test(record.evidenceSha256) ||
      !DIGEST.test(record.inventorySha256) ||
      record.evidenceSha256 !== verifyEvidenceBundle(evidence).digest ||
      record.inventorySha256 !== baselineInventorySha256) {
    throw new DriftError('CHANGE_RECORD_MISMATCH_OR_UNVERIFIED');
  }
  const approvedAt = parsedIso(record.recordedAt);
  const evidenceAt = parsedIso(evidence.generatedAt);
  if (!Number.isFinite(approvedAt) || approvedAt < evidenceAt ||
      approvedAt > nowMs + CLOCK_SKEW_MS) {
    throw new DriftError('CHANGE_RECORD_TIME_INVALID');
  }
  return {changeRef: record.changeRef, recordedAt: record.recordedAt};
}

function readLocalJson(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > INPUT_LIMIT) throw new Error('bad input');
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new DriftError('INPUT_INVALID_OR_UNSAFE');
  }
}

export function parseDriftArgs(args) {
  if (args.length === 4 && args[0] === '--fingerprint-inventory' &&
      args[2] === '--deployment' && isAbsolute(args[1]) &&
      typeof args[3] === 'string' &&
      /^[a-z][a-z0-9_-]{0,39}$/.test(args[3])) {
    return {fingerprintPath: args[1], fingerprintDeployment: args[3]};
  }
  const supported = [
    '--baseline', '--baseline-inventory', '--current-inventory',
    '--current-report', '--change-record',
  ];
  if (args.length !== supported.length * 2) {
    throw new DriftError('INVALID_ARGUMENTS');
  }
  const params = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!supported.includes(flag) || params.has(flag) ||
        typeof value !== 'string' || !isAbsolute(value)) {
      throw new DriftError('INVALID_ARGUMENTS');
    }
    params.set(flag, value);
  }
  if (params.size !== supported.length ||
      new Set(params.values()).size !== supported.length) {
    throw new DriftError('INVALID_ARGUMENTS');
  }
  return Object.fromEntries([...params].map(([key, value]) => [
    {
      '--baseline': 'baselinePath',
      '--baseline-inventory': 'baselineInventoryPath',
      '--current-inventory': 'currentInventoryPath',
      '--current-report': 'currentReportPath',
      '--change-record': 'changeRecordPath',
    }[key], value,
  ]));
}

function validateCurrentReport(report, deployment, nowMs) {
  if (!exactKeys(report, [
    'version', 'checkedAt', 'deployment', 'status', 'expectedReplicas',
    'observedReplicas', 'checks', 'reasons',
  ]) || report.version !== 1 || report.deployment !== deployment) {
    throw new DriftError('CURRENT_REPORT_INVALID');
  }
  const checkedAt = parsedIso(report.checkedAt);
  if (!Number.isFinite(checkedAt) ||
      checkedAt > nowMs + CLOCK_SKEW_MS ||
      nowMs - checkedAt > REPORT_MAX_AGE_MS) {
    throw new DriftError('CURRENT_REPORT_STALE');
  }
  if (report.status === 'READY_FOR_REVIEW') {
    try {
      return {kind: 'ready', report: validatePreflightEvidence(report, nowMs)};
    } catch {
      throw new DriftError('CURRENT_REPORT_INVALID');
    }
  }
  if (report.status === 'BLOCKED' &&
      Number.isSafeInteger(report.expectedReplicas) &&
      report.expectedReplicas >= 1 && report.expectedReplicas <= 200 &&
      (report.observedReplicas === null ||
        (Number.isSafeInteger(report.observedReplicas) &&
         report.observedReplicas >= 0 && report.observedReplicas <= 200)) &&
      exactKeys(report.checks, Object.keys(report.checks ?? {})) &&
      Object.keys(report.checks).length <= 12 &&
      Object.keys(report.checks).every(key =>
        /^[a-z][a-z0-9_]{0,63}$/.test(key) &&
        (report.checks[key] === null ||
          (typeof report.checks[key] === 'number' &&
           Number.isFinite(report.checks[key])))) &&
      Array.isArray(report.reasons) && report.reasons.length <= 30 &&
      report.reasons.every(reason =>
        typeof reason === 'string' && /^[A-Z][A-Z0-9_]{1,99}$/.test(reason))) {
    return {kind: 'blocked', report: {
      expectedReplicas: report.expectedReplicas,
      observedReplicas: report.observedReplicas,
      reasons: [...new Set(report.reasons)].sort(),
    }};
  }
  throw new DriftError('CURRENT_REPORT_INVALID');
}

/**
 * Never claims successful rollout. Compares the approved baseline evidence
 * with a fresh independently collected PR #142 report and inventory.
 * Return only aggregate counts, numeric deltas and safe reason codes.
 */
export function evaluatePostRollout({
  baseline, baselineInventory, currentInventory, currentReport, changeRecord,
  nowMs = Date.now(),
}) {
  const base = verifyEvidenceBundle(baseline);
  const issuedAt = parsedIso(baseline.generatedAt);
  if (!Number.isFinite(issuedAt) ||
      issuedAt > nowMs + CLOCK_SKEW_MS) {
    throw new DriftError('BASELINE_TIME_INVALID');
  }
  const deployment = base.deployment;
  const baselineTargets = selectDeployment(baselineInventory, deployment);
  if (baselineTargets.instances.length !== baseline.preflight.expectedReplicas) {
    throw new DriftError('BASELINE_INVENTORY_COUNT_MISMATCH');
  }
  const baselineHash = inventoryFingerprint(baselineInventory, deployment);
  const approval = validateChangeRecord(
    changeRecord, baseline, baselineHash.sha256, nowMs,
  );
  const currentTargets = selectDeployment(currentInventory, deployment);
  const latest = validateCurrentReport(currentReport, deployment, nowMs);
  if (parsedIso(currentReport.checkedAt) < parsedIso(approval.recordedAt)) {
    throw new DriftError('CURRENT_REPORT_PREDATES_CHANGE');
  }

  const before = new Set(baselineTargets.instances);
  const after = new Set(currentTargets.instances);
  const added = [...after].filter(item => !before.has(item)).length;
  const removed = [...before].filter(item => !after.has(item)).length;
  const reasons = new Set();
  if (added || removed) reasons.add('REPLICA_MEMBERSHIP_DRIFT');
  if (currentTargets.instances.length !==
      (latest.report.expectedReplicas ?? 0)) {
    reasons.add('CURRENT_INVENTORY_REPORT_COUNT_MISMATCH');
  }

  const report = {
    version: 1,
    comparedAt: new Date(nowMs).toISOString(),
    deployment, changeRef: approval.changeRef,
    status: 'BLOCKED',
    baselineReplicas: before.size,
    currentInventoryReplicas: after.size,
    replicaChanges: {added, removed},
    currentPreflightStatus: currentReport.status,
    baselineEvidenceSha256: base.digest,
    metrics: null, reasons: [],
    safeguards: {
      networkCalls: false,
      alertsActivated: false,
      deploymentExecuted: false,
      externallyAuthenticatedApproval: false,
    },
  };
  if (latest.kind === 'blocked') {
    reasons.add('CURRENT_PREFLIGHT_BLOCKED');
    for (const reason of latest.report.reasons) reasons.add('CURRENT_' + reason);
  } else {
    const oldChecks = baseline.preflight.checks;
    const newChecks = latest.report.checks;
    const baselineAvailability = oldChecks.http_availability_verified_30d;
    const currentAvailability = newChecks.http_availability_verified_30d;
    const baselineBudget = oldChecks.http_error_budget_consumed_verified_30d;
    const currentBudget = newChecks.http_error_budget_consumed_verified_30d;
    const availabilityDrop = Math.max(0, baselineAvailability - currentAvailability);
    const budgetIncrease = Math.max(0, currentBudget - baselineBudget);
    report.metrics = {
      availabilityBaseline: baselineAvailability,
      availabilityCurrent: currentAvailability,
      availabilityDrop,
      errorBudgetConsumedBaseline: baselineBudget,
      errorBudgetConsumedCurrent: currentBudget,
      errorBudgetConsumptionIncrease: budgetIncrease,
    };
    if (availabilityDrop >= SLO_DROP_THRESHOLD) {
      reasons.add('AVAILABILITY_DEGRADED');
    }
    if (budgetIncrease >= BUDGET_INCREASE_THRESHOLD) {
      reasons.add('ERROR_BUDGET_CONSUMPTION_INCREASED');
    }
    if (latest.report.expectedReplicas !== currentTargets.instances.length ||
        latest.report.observedReplicas !== currentTargets.instances.length) {
      reasons.add('CURRENT_REPLICA_COUNT_MISMATCH');
    }
  }
  report.reasons = [...reasons].sort();
  if (report.reasons.length === 0) report.status = 'NO_DRIFT_FOR_MANUAL_REVIEW';
  return report;
}

async function main(args) {
  try {
    const params = parseDriftArgs(args);
    if (params.fingerprintPath) {
      const value = inventoryFingerprint(
        readLocalJson(params.fingerprintPath), params.fingerprintDeployment,
      );
      process.stdout.write(JSON.stringify({
        status: 'INVENTORY_FINGERPRINT',
        deployment: params.fingerprintDeployment,
        replicaCount: value.count,
        inventorySha256: value.sha256,
      }) + '\n');
      return;
    }
    const report = evaluatePostRollout({
      baseline: readLocalJson(params.baselinePath),
      baselineInventory: readLocalJson(params.baselineInventoryPath),
      currentInventory: readLocalJson(params.currentInventoryPath),
      currentReport: readLocalJson(params.currentReportPath),
      changeRecord: readLocalJson(params.changeRecordPath),
    });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.status !== 'NO_DRIFT_FOR_MANUAL_REVIEW') process.exitCode = 2;
  } catch (error) {
    process.stdout.write(JSON.stringify({
      status: 'BLOCKED',
      reasons: [error instanceof DriftError ? error.code : 'POST_ROLLOUT_CHECK_FAILED'],
    }) + '\n');
    process.exitCode = 2;
  }
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
