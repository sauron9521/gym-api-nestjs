#!/usr/bin/env node
/**
 * Root-signed Ed25519 signing-key policy and independently pinned local
 * replay-ledger head. Offline: no network, production mutation or signing.
 * The root signing private key is NEVER loaded by this module.
 */
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertNotPreviouslyRecorded, recordVerifiedApproval, verifyLedger,
  verifySignedApproval, ProvenanceError,
} from './monitoring-slo-provenance.mjs';

const DOMAIN = 'gym-api-slo-key-policy/v1';
const ZERO_HASH = '0'.repeat(64);
const HEX = /^[a-f0-9]{64}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const DEPLOYMENT = /^[a-z][a-z0-9_-]{0,39}$/;
const MAX_POLICY_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 60_000;
const MAX_BYTES = 65_536;
const LEDGER_LIMIT = 2_000_000;
const POLICY_FIELDS = ['version','domain','sequence','issuedAt','expiresAt',
  'previousPolicySha256','keys'];
const KEY_FIELDS = ['keyId','fingerprintSha256','deployments','validFrom',
  'validUntil','state','disabledAt'];

export class KeyLifecycleError extends Error {
  constructor(code) {
    super(code);
    this.name = 'KeyLifecycleError';
    this.code = code;
  }
}
const exact = (value, keys) =>
  value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const sha256 = input => createHash('sha256').update(input).digest('hex');
function isoDate(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}
function canonicalBase64Signature(encoded) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(encoded)) {
    throw new KeyLifecycleError('POLICY_SIGNATURE_INVALID');
  }
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.length !== 64 || bytes.toString('base64url') !== encoded) {
    throw new KeyLifecycleError('POLICY_SIGNATURE_INVALID');
  }
  return bytes;
}

export function policySigningBytes(policy) {
  if (!exact(policy, POLICY_FIELDS) || policy.version !== 1 ||
      policy.domain !== DOMAIN || !Number.isSafeInteger(policy.sequence) ||
      policy.sequence < 1 || policy.sequence > 1_000_000 ||
      typeof policy.previousPolicySha256 !== 'string' ||
      !HEX.test(policy.previousPolicySha256) ||
      (policy.sequence === 1 && policy.previousPolicySha256 !== ZERO_HASH) ||
      (policy.sequence > 1 && policy.previousPolicySha256 === ZERO_HASH) ||
      !Array.isArray(policy.keys) || !policy.keys.length ||
      policy.keys.length > 32) {
    throw new KeyLifecycleError('POLICY_SCHEMA_INVALID');
  }
  const issued = isoDate(policy.issuedAt);
  const expires = isoDate(policy.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) ||
      issued >= expires || expires - issued > MAX_POLICY_LIFETIME_MS) {
    throw new KeyLifecycleError('POLICY_TIME_INVALID');
  }
  const ids = new Set(), fingerprints = new Set();
  let lastId = '';
  for (const key of policy.keys) {
    if (!exact(key, KEY_FIELDS) ||
        typeof key.keyId !== 'string' || !KEY_ID.test(key.keyId) ||
        key.keyId <= lastId || ids.has(key.keyId) ||
        typeof key.fingerprintSha256 !== 'string' ||
        !HEX.test(key.fingerprintSha256) ||
        fingerprints.has(key.fingerprintSha256) ||
        !Array.isArray(key.deployments) || !key.deployments.length ||
        key.deployments.length > 20 ||
        !['active','retired','revoked'].includes(key.state)) {
      throw new KeyLifecycleError('POLICY_KEY_INVALID');
    }
    ids.add(key.keyId);
    fingerprints.add(key.fingerprintSha256);
    lastId = key.keyId;
    const from = isoDate(key.validFrom), until = isoDate(key.validUntil);
    if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until) {
      throw new KeyLifecycleError('POLICY_KEY_TIME_INVALID');
    }
    let lastDeployment = '';
    for (const name of key.deployments) {
      if (typeof name !== 'string' || !DEPLOYMENT.test(name) ||
          name <= lastDeployment) throw new KeyLifecycleError('POLICY_SCOPE_INVALID');
      lastDeployment = name;
    }
    if (key.state === 'active' ? key.disabledAt !== null :
        !Number.isFinite(isoDate(key.disabledAt)) ||
        isoDate(key.disabledAt) < from ||
        isoDate(key.disabledAt) > issued) {
      throw new KeyLifecycleError('POLICY_KEY_STATE_INVALID');
    }
  }
  const canonicalKeys = policy.keys.map(key =>
    Object.fromEntries(KEY_FIELDS.map(field => [field,key[field]])));
  const canonical = Object.fromEntries(POLICY_FIELDS.map(field =>
    [field,field === 'keys' ? canonicalKeys : policy[field]]));
  return Buffer.from(DOMAIN + '\n' + JSON.stringify(canonical),'utf8');
}

/**
 * A valid root signature proves authenticity only relative to the
 * independently pinned root fingerprint. Pinned policy digest AND sequence
 * are also mandatory: otherwise a revoked key could be reenabled by
 * replaying an older but correctly signed policy.
 */
export function verifySignedPolicy({
  policy, signature, rootPublicKeyPem, trustedRootSha256,
  trustedPolicySha256, trustedPolicySequence,
  nowMs = Date.now(), allowExpiredForHistory = false,
}) {
  const bytes = policySigningBytes(policy);
  const issued = isoDate(policy.issuedAt);
  const expires = isoDate(policy.expiresAt);
  if (issued > nowMs + FUTURE_SKEW_MS ||
      (!allowExpiredForHistory && nowMs >= expires)) {
    throw new KeyLifecycleError('POLICY_EXPIRED_OR_FUTURE');
  }
  if (typeof trustedRootSha256 !== 'string' || !HEX.test(trustedRootSha256) ||
      typeof trustedPolicySha256 !== 'string' || !HEX.test(trustedPolicySha256) ||
      !Number.isSafeInteger(trustedPolicySequence) ||
      trustedPolicySequence !== policy.sequence) {
    throw new KeyLifecycleError('POLICY_TRUST_ANCHOR_INVALID');
  }
  const digest = sha256(bytes);
  if (digest !== trustedPolicySha256) {
    throw new KeyLifecycleError('POLICY_ROLLBACK_OR_MISMATCH');
  }
  let root;
  try {
    root = createPublicKey(rootPublicKeyPem);
    if (root.asymmetricKeyType !== 'ed25519') throw Error();
  } catch {
    throw new KeyLifecycleError('ROOT_PUBLIC_KEY_INVALID');
  }
  const rootDigest = sha256(root.export({format:'der',type:'spki'}));
  if (rootDigest !== trustedRootSha256) {
    throw new KeyLifecycleError('ROOT_PUBLIC_KEY_UNTRUSTED');
  }
  const signatureBytes = canonicalBase64Signature(signature);
  if (!verifySignature(null,bytes,root,signatureBytes)) {
    throw new KeyLifecycleError('POLICY_SIGNATURE_INVALID');
  }
  return {policy, policySha256:digest, rootSha256:rootDigest,
    sequence:policy.sequence};
}

/** Compare two independently root-verified policies; never reactivate keys. */
export function validatePolicyTransition(previous, next) {
  if (!previous?.policy || !next?.policy ||
      previous.rootSha256 !== next.rootSha256 ||
      next.sequence !== previous.sequence + 1 ||
      next.policy.previousPolicySha256 !== previous.policySha256 ||
      isoDate(next.policy.issuedAt) <= isoDate(previous.policy.issuedAt)) {
    throw new KeyLifecycleError('POLICY_TRANSITION_INVALID');
  }
  const currentKeys = new Map(next.policy.keys.map(key=>[key.keyId,key]));
  for (const oldKey of previous.policy.keys) {
    const key = currentKeys.get(oldKey.keyId);
    if (!key || oldKey.fingerprintSha256 !== key.fingerprintSha256 ||
        oldKey.validFrom !== key.validFrom ||
        oldKey.validUntil !== key.validUntil ||
        JSON.stringify(oldKey.deployments) !== JSON.stringify(key.deployments)) {
      throw new KeyLifecycleError('POLICY_KEY_REPLACED');
    }
    const states = {
      active:['active','retired','revoked'],
      retired:['retired','revoked'],
      revoked:['revoked'],
    };
    if (!states[oldKey.state].includes(key.state) ||
        (oldKey.state !== 'active' &&
         oldKey.disabledAt !== key.disabledAt &&
         key.state === oldKey.state) ||
        (oldKey.state === 'active' && key.state !== 'active' &&
         isoDate(key.disabledAt) < isoDate(previous.policy.issuedAt))) {
      throw new KeyLifecycleError('POLICY_REACTIVATION_FORBIDDEN');
    }
  }
  for (const key of next.policy.keys) {
    if (!previous.policy.keys.some(old=>old.keyId===key.keyId) &&
        key.state !== 'active') {
      throw new KeyLifecycleError('POLICY_NEW_KEY_INVALID');
    }
  }
  return {valid:true,fromSequence:previous.sequence,toSequence:next.sequence,
    policySha256:next.policySha256,externallyApproved:false};
}

/**
 * New approvals require a currently active and in-scope key. Retired keys
 * remain in signed historical policy for ledger review, but cannot authorize
 * new approvals. Revoked keys always fail.
 */
export function trustedSignerFromPolicy(verifiedPolicy, approval, nowMs = Date.now()) {
  if (!verifiedPolicy?.policy || !approval ||
      typeof approval.signerKeyId !== 'string') {
    throw new KeyLifecycleError('SIGNER_NOT_IN_POLICY');
  }
  const key = verifiedPolicy.policy.keys.find(k=>k.keyId===approval.signerKeyId);
  if (!key) throw new KeyLifecycleError('SIGNER_NOT_IN_POLICY');
  if (key.state !== 'active') throw new KeyLifecycleError('SIGNER_RETIRED_OR_REVOKED');
  const approved = isoDate(approval.approvedAt);
  const expires = isoDate(approval.expiresAt);
  if (!key.deployments.includes(approval.deployment) ||
      !Number.isFinite(approved) || !Number.isFinite(expires) ||
      approved < isoDate(key.validFrom) ||
      expires > isoDate(key.validUntil) ||
      nowMs >= isoDate(key.validUntil)) {
    throw new KeyLifecycleError('SIGNER_OUT_OF_SCOPE_OR_WINDOW');
  }
  return key.fingerprintSha256;
}

export function verifyPolicyApproval({
  policyInputs, approval, signature, signerPublicKeyPem, evidence,
  inventory, nowMs = Date.now(),
}) {
  const verifiedPolicy = verifySignedPolicy({...policyInputs,nowMs});
  const signerFingerprint = trustedSignerFromPolicy(
    verifiedPolicy,approval,nowMs,
  );
  const verified = verifySignedApproval({
    approval, signature, publicKeyPem:signerPublicKeyPem,
    trustedKeySha256:signerFingerprint,
    evidence,inventory,nowMs,
  });
  return {verifiedPolicy,verified};
}

/**
 * Check the EXACT externally anchored ledger head, not just an arbitrary
 * prefix; prevents accepting rollback to a shorter still-valid hash chain.
 */
export function verifyAnchoredLedger(contents, expectedRows, expectedHead) {
  if (!Number.isSafeInteger(expectedRows) || expectedRows < 0 ||
      expectedRows > 5000 || typeof expectedHead !== 'string' ||
      !HEX.test(expectedHead)) {
    throw new KeyLifecycleError('LEDGER_ANCHOR_INVALID');
  }
  let state;
  try { state=verifyLedger(contents); }
  catch { throw new KeyLifecycleError('LEDGER_INVALID'); }
  if (state.rows !== expectedRows || state.headSha256 !== expectedHead) {
    throw new KeyLifecycleError('LEDGER_ANCHOR_MISMATCH');
  }
  return state;
}

function readRegular(path,max=MAX_BYTES) {
  try {
    const info=lstatSync(path);
    if (!info.isFile() || info.size>max) throw Error();
    return readFileSync(path,'utf8');
  } catch {
    throw new KeyLifecycleError('INPUT_INVALID_OR_UNSAFE');
  }
}
function readJson(path) {
  try {return JSON.parse(readRegular(path));}
  catch(err) {
    if(err instanceof KeyLifecycleError)throw err;
    throw new KeyLifecycleError('INPUT_INVALID_OR_UNSAFE');
  }
}
function loadAnchoredLedger(path,rows,hash) {
  if (!isAbsolute(path) || !path.endsWith('.jsonl'))
    throw new KeyLifecycleError('LEDGER_PATH_INVALID');
  if (!existsSync(path)) {
    if (rows!==0 || hash!==ZERO_HASH)
      throw new KeyLifecycleError('LEDGER_ANCHOR_MISMATCH');
    return verifyAnchoredLedger('',rows,hash);
  }
  return verifyAnchoredLedger(readRegular(path,LEDGER_LIMIT),rows,hash);
}

export function parseKeyLifecycleArgs(args) {
  if (args.length%2) throw new KeyLifecycleError('INVALID_ARGUMENTS');
  const allowed=[
    '--mode','--ledger','--trusted-ledger-sequence',
    '--trusted-ledger-head-sha256','--policy','--policy-signature',
    '--root-public-key','--trusted-root-sha256',
    '--trusted-policy-sha256','--trusted-policy-sequence',
    '--evidence','--inventory','--approval','--signature',
    '--signer-public-key',
  ];
  const map=new Map();
  for(let i=0;i<args.length;i+=2){
    if(!allowed.includes(args[i]) || map.has(args[i]) ||
       typeof args[i+1]!=='string' || !args[i+1])
      throw new KeyLifecycleError('INVALID_ARGUMENTS');
    map.set(args[i],args[i+1]);
  }
  const mode=map.get('--mode');
  if (!['verify','record','audit'].includes(mode))
    throw new KeyLifecycleError('INVALID_ARGUMENTS');
  const common=[
    '--mode','--ledger','--trusted-ledger-sequence',
    '--trusted-ledger-head-sha256',
  ];
  if(mode==='audit' ? map.size!==common.length :
     map.size!==allowed.length)
    throw new KeyLifecycleError('INVALID_ARGUMENTS');
  const selected=mode==='audit'?common:allowed;
  if(selected.some(k=>!map.has(k)))
    throw new KeyLifecycleError('INVALID_ARGUMENTS');
  const fileFlags=selected.filter(k=>
    !['--mode','--trusted-ledger-sequence',
      '--trusted-ledger-head-sha256','--trusted-root-sha256',
      '--trusted-policy-sha256','--trusted-policy-sequence'].includes(k));
  if(fileFlags.some(k=>!isAbsolute(map.get(k))) ||
     new Set(fileFlags.map(k=>map.get(k))).size!==fileFlags.length ||
     !/^(0|[1-9]\d{0,5})$/.test(map.get('--trusted-ledger-sequence')) ||
     !HEX.test(map.get('--trusted-ledger-head-sha256')) ||
     (mode!=='audit' &&
       (!HEX.test(map.get('--trusted-root-sha256')) ||
        !HEX.test(map.get('--trusted-policy-sha256')) ||
        !/^[1-9]\d{0,5}$/.test(map.get('--trusted-policy-sequence'))))) {
    throw new KeyLifecycleError('INVALID_ARGUMENTS');
  }
  return {
    mode, ledger:map.get('--ledger'),
    expectedRows:Number(map.get('--trusted-ledger-sequence')),
    expectedHead:map.get('--trusted-ledger-head-sha256'),
    ...(mode==='audit'?{}:{
      policy:map.get('--policy'),policySignature:map.get('--policy-signature'),
      rootPublicKey:map.get('--root-public-key'),
      trustedRootSha256:map.get('--trusted-root-sha256'),
      trustedPolicySha256:map.get('--trusted-policy-sha256'),
      trustedPolicySequence:Number(map.get('--trusted-policy-sequence')),
      evidence:map.get('--evidence'),inventory:map.get('--inventory'),
      approval:map.get('--approval'),signature:map.get('--signature'),
      signerPublicKey:map.get('--signer-public-key'),
    }),
  };
}

async function main(args) {
  try {
    const opts=parseKeyLifecycleArgs(args);
    const state=loadAnchoredLedger(opts.ledger,opts.expectedRows,opts.expectedHead);
    if(opts.mode==='audit'){
      process.stdout.write(JSON.stringify({
        status:'LEDGER_HEAD_MATCHES_INDEPENDENT_PIN',
        entries:state.rows,headSha256:state.headSha256,
        pinProvenanceChecked:false, productionAuthorized:false,
      })+'\n');
      return;
    }
    const {verifiedPolicy,verified}=verifyPolicyApproval({
      policyInputs:{
        policy:readJson(opts.policy),
        signature:readRegular(opts.policySignature,1024).trim(),
        rootPublicKeyPem:readRegular(opts.rootPublicKey,8192),
        trustedRootSha256:opts.trustedRootSha256,
        trustedPolicySha256:opts.trustedPolicySha256,
        trustedPolicySequence:opts.trustedPolicySequence,
      },
      approval:readJson(opts.approval),
      signature:readRegular(opts.signature,1024).trim(),
      signerPublicKeyPem:readRegular(opts.signerPublicKey,8192),
      evidence:readJson(opts.evidence),inventory:readJson(opts.inventory),
    });
    assertNotPreviouslyRecorded(verified,state);
    if(opts.mode==='verify'){
      process.stdout.write(JSON.stringify({
        status:'KEY_POLICY_APPROVAL_VERIFIED_FOR_HUMAN_REVIEW',
        deployment:verified.deployment,changeRef:verified.changeRef,
        policySequence:verifiedPolicy.sequence,
        policySha256:verifiedPolicy.policySha256,
        signerKeySha256:verified.signerKeySha256,
        authenticatedSignature:true,externalTicketStateChecked:false,
        productionAuthorized:false,ledgerRecorded:false,
      })+'\n');
      return;
    }
    const result=recordVerifiedApproval(opts.ledger,verified,Date.now(),{
      rows:opts.expectedRows,headSha256:opts.expectedHead,
    });
    process.stdout.write(JSON.stringify({
      status:'KEY_POLICY_APPROVAL_RECORDED_FOR_HUMAN_REVIEW',
      deployment:verified.deployment,changeRef:verified.changeRef,
      policySequence:verifiedPolicy.sequence,
      policySha256:verifiedPolicy.policySha256,
      ledgerRows:result.rows,ledgerHeadSha256:result.headSha256,
      authenticatedSignature:true,externalTicketStateChecked:false,
      productionAuthorized:false,
    })+'\n');
  } catch(err) {
    process.stdout.write(JSON.stringify({
      status:'BLOCKED',reasons:[
        err instanceof KeyLifecycleError || err instanceof ProvenanceError ?
          err.code : 'KEY_LIFECYCLE_FAILED',
      ],
    })+'\n');
    process.exitCode=2;
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  await main(process.argv.slice(2));
}
