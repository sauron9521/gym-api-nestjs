import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { PREFLIGHT_METRICS } from './monitoring-slo-preflight.mjs';
import { createEvidenceBundle, REQUIRED_CONFIRMATIONS } from './monitoring-slo-rollout-evidence.mjs';
import { inventoryFingerprint } from './monitoring-slo-postrollout.mjs';
import {
  approvalSigningBytes, assertNotPreviouslyRecorded, parseProvenanceArgs,
  ProvenanceError, recordVerifiedApproval, verifyLedger, verifySignedApproval,
} from './monitoring-slo-provenance.mjs';

const now = Date.parse('2026-11-11T19:15:00.000Z');
const iso = value => new Date(value).toISOString();
const deployment = 'production';
const instances = ['prod-a.internal:8443', 'prod-b.internal:8443'];
const checks = Object.fromEntries(PREFLIGHT_METRICS.map(metric => [
  metric.split(':').at(-1),
  metric.includes('coverage') || metric.endsWith('scrape_success_30d') ? 0.997 :
    metric.endsWith('availability_verified_30d') ? 0.999 :
      metric.endsWith('error_budget_consumed_verified_30d') ? 1 : 1,
]));

function fixture(referenceTime = now, changeRef = 'CHG-145-PROVENANCE', nonce = 'a'.repeat(32)) {
  const keys = generateKeyPairSync('ed25519');
  const inventory = {
    version: 1, scrapeIntervalSeconds: 30,
    deployments: [{name: deployment, instances}],
  };
  const preflight = {
    version: 1, checkedAt: iso(referenceTime - 4 * 60_000), deployment,
    status: 'READY_FOR_REVIEW', expectedReplicas: 2, observedReplicas: 2,
    checks: {...checks}, reasons: [],
  };
  const review = {
    version: 1, deployment, changeRef,
    reviewer: 'operator-01',
    reviewedAt: iso(referenceTime - 3 * 60_000),
    decision: 'REVIEWED_FOR_STAGING',
    confirmations: Object.fromEntries(REQUIRED_CONFIRMATIONS.map(key => [key,true])),
  };
  const evidence = createEvidenceBundle(preflight, review, referenceTime - 2 * 60_000);
  const evidenceDigest = createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  const approval = {
    version: 1, domain: 'gym-api-slo-change-approval/v1',
    deployment, changeRef: review.changeRef,
    decision: 'STAGING_ROLLOUT_REVIEWED',
    evidenceSha256: evidenceDigest,
    inventorySha256: inventoryFingerprint(inventory, deployment).sha256,
    approvedAt: iso(referenceTime - 60_000),
    expiresAt: iso(referenceTime + 60 * 60_000),
    nonce, signerKeyId: 'staging-approver-01',
  };
  const signature = sign(null, approvalSigningBytes(approval),
    keys.privateKey).toString('base64url');
  const publicKeyPem = keys.publicKey.export({format:'pem',type:'spki'});
  const trustedKeySha256 = createHash('sha256').update(
    keys.publicKey.export({format:'der',type:'spki'}),
  ).digest('hex');
  return {
    approval, signature, publicKeyPem, trustedKeySha256,
    evidence, inventory, nowMs: referenceTime,
  };
}

test('valid signed, scope-bound, fresh Ed25519 record verifies without granting production actions', () => {
  const sample = fixture();
  const result = verifySignedApproval(sample);
  assert.equal(result.status, 'SIGNED_APPROVAL_VERIFIED_FOR_HUMAN_REVIEW');
  assert.equal(result.authenticatedSignature, true);
  assert.equal(result.externalTicketStateChecked, false);
  assert.equal(result.productionAuthorized, false);
  assert.equal(result.changeRef, 'CHG-145-PROVENANCE');
  assert.equal(result.signerKeySha256, sample.trustedKeySha256);
  assert.match(result.approvalSha256, /^[a-f0-9]{64}$/);
  const output = JSON.stringify(result);
  assert.doesNotMatch(output, /prod-a.internal|Bearer|PRIVATE KEY|password|https?:\/\//i);
});

test('tampering, wrong scope or key cannot be laundered into signature validation', () => {
  const sample = fixture();
  const cases = [
    {signature: (sample.signature[0]==='A'?'B':'A') + sample.signature.slice(1)},
    {signature: 'x'},
    {trustedKeySha256: 'f'.repeat(64)},
    {publicKeyPem: '-----BEGIN PRIVATE KEY-----'},
    {approval: {...sample.approval, changeRef:'CHG-ANOTHER'}},
    {approval: {...sample.approval, deployment:'staging'}},
    {approval: {...sample.approval, nonce:'b'.repeat(32)}},
    {approval: {...sample.approval, signerKeyId:'OTHER-KEY'}},
    {approval: {...sample.approval, decision:'APPROVED_FOR_PRODUCTION'}},
    {approval: {...sample.approval, extra:'inject'}},
    {approval: {...sample.approval, evidenceSha256:'0'.repeat(64)}},
    {approval: {...sample.approval, inventorySha256:'0'.repeat(64)}},
    {approval: {...sample.approval, domain:'a-different-domain'}},
    {evidence: {...sample.evidence, deployment:'staging'}},
    {inventory: {...sample.inventory, deployments:[
      {name:deployment, instances:[instances[0],'prod-c.internal:8443']},
    ]}},
  ];
  for (const patch of cases) {
    assert.throws(() => verifySignedApproval({...sample,...patch}), ProvenanceError);
  }
});

test('expired approvals, invalid time orders and excessive lifetime fail closed', () => {
  const sample = fixture();
  for (const [approval, instant] of [
    [{...sample.approval,expiresAt:iso(now-1)}, now],
    [{...sample.approval,expiresAt:iso(now+25*60*60_000)}, now],
    [{...sample.approval,approvedAt:iso(now-3*60_000)}, now],
    [{...sample.approval,approvedAt:iso(now+5*60_000)}, now],
    [{...sample.approval,expiresAt:'2026-11-11'}, now],
    [sample.approval, now+2*60*60_000],
  ]) {
    assert.throws(() => verifySignedApproval({...sample,approval,nowMs:instant}),
      /APPROVAL_EXPIRED_OR_INVALID_TIME/);
  }
});

test('hash-chained ledger rejects byte edits, reordered rows, partial writes and duplicates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gym-api-slo-signed-ledger-'));
  try {
    const path = join(dir,'approvals.slo-provenance.jsonl');
    const first = verifySignedApproval(fixture());
    const written = recordVerifiedApproval(path,first,now);
    assert.equal(written.rows,1);
    assert.match(written.headSha256,/^[a-f0-9]{64}$/);
    if(process.platform!=='win32') assert.equal(statSync(path).mode & 0o777,0o600);
    let state=verifyLedger(readFileSync(path,'utf8'));
    assert.equal(state.rows,1);
    assert.equal(state.headSha256,written.headSha256);
    assert.throws(() => assertNotPreviouslyRecorded(first,state),
      /APPROVAL_REPLAY_DETECTED/);
    assert.throws(() => recordVerifiedApproval(path,first,now+1),
      /APPROVAL_REPLAY_DETECTED/);
    assert.equal(verifyLedger(readFileSync(path,'utf8')).rows,1);

    const secondVerified = verifySignedApproval(
      fixture(now + 10*60_000, 'CHG-145-SECOND', 'b'.repeat(32)),
    );
    const after = recordVerifiedApproval(path,secondVerified,now+10*60_000);
    assert.equal(after.rows,2);
    state=verifyLedger(readFileSync(path,'utf8'));
    assert.equal(state.rows,2);
    assert.equal(state.headSha256,after.headSha256);
    const original=readFileSync(path,'utf8');
    assert.throws(() => verifyLedger(original.slice(0,-1)),/LEDGER_CORRUPT/);
    assert.throws(() => verifyLedger(original.replace('CHG-145-SECOND','CHG-FORGED-SECOND')),
      /LEDGER_CORRUPT/);
    assert.throws(() => verifyLedger(original.trimEnd().split('\n').reverse().join('\n')+'\n'),
      /LEDGER_CORRUPT/);
    assert.throws(() => verifyLedger(original+original.split('\n')[0]+'\n'),
      ProvenanceError);

    const symlink=join(dir,'bad.jsonl');
    symlinkSync(path,symlink);
    assert.throws(() => recordVerifiedApproval(symlink,secondVerified),ProvenanceError);
    const locked=join(dir,'locked.jsonl');
    writeFileSync(locked+'.lock','');
    assert.throws(()=>recordVerifiedApproval(locked,first),/LEDGER_LOCKED/);
    assert.ok(existsSync(locked+'.lock'));
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('CLI validates arguments, local signing files, replay and audit', () => {
  const dir=mkdtempSync(join(tmpdir(),'gym-api-slo-provenance-cli-'));
  const cli=new URL('./monitoring-slo-provenance.mjs',import.meta.url).pathname;
  try{
    const sample=fixture(Date.now());
    const paths={
      approval:join(dir,'approval.slo-approval.json'),
      signature:join(dir,'approval.slo-signature'),
      publicKey:join(dir,'trust-pubkey.pem'),
      evidence:join(dir,'baseline.slo-evidence.json'),
      inventory:join(dir,'baseline-inventory.json'),
      ledger:join(dir,'approvals.slo-provenance.jsonl'),
    };
    for(const [key,path] of Object.entries(paths)){
      if(key==='ledger')continue;
      writeFileSync(path,
        key==='signature'?sample.signature:
        key==='publicKey'?sample.publicKeyPem:
        JSON.stringify(sample[key]));
    }
    const args=mode=>[
      '--mode',mode,'--evidence',paths.evidence,
      '--inventory',paths.inventory,'--approval',paths.approval,
      '--signature',paths.signature,'--public-key',paths.publicKey,
      '--trusted-key-sha256',sample.trustedKeySha256,'--ledger',paths.ledger,
    ];
    assert.equal(parseProvenanceArgs(args('verify')).mode,'verify');
    assert.throws(()=>parseProvenanceArgs(args('verify').slice(0,-2)),ProvenanceError);
    assert.throws(()=>parseProvenanceArgs([...args('verify'),'--mode','record']),ProvenanceError);
    let result=spawnSync(process.execPath,[cli,...args('verify')],{encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(JSON.parse(result.stdout).authenticatedSignature,true);
    assert.equal(JSON.parse(result.stdout).status,'SIGNED_APPROVAL_VERIFIED_FOR_HUMAN_REVIEW');
    assert.ok(!existsSync(paths.ledger),'verify must never write ledger');
    result=spawnSync(process.execPath,[cli,...args('record')],{encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(JSON.parse(result.stdout).status,'SIGNED_APPROVAL_RECORDED_FOR_HUMAN_REVIEW');
    assert.equal(JSON.parse(result.stdout).ledgerRows,1);
    result=spawnSync(process.execPath,[cli,...args('verify')],{encoding:'utf8'});
    assert.equal(result.status,2);
    assert.deepEqual(JSON.parse(result.stdout).reasons,['APPROVAL_REPLAY_DETECTED']);
    result=spawnSync(process.execPath,[cli,'--mode','audit','--ledger',paths.ledger],
      {encoding:'utf8'});
    assert.equal(result.status,0);
    assert.equal(JSON.parse(result.stdout).status,'LOCAL_HASH_CHAIN_INTACT');
    assert.equal(JSON.parse(result.stdout).entries,1);
    assert.equal(JSON.parse(result.stdout).externallyAnchored,false);
    writeFileSync(paths.signature,'invalid-signature');
    result=spawnSync(process.execPath,[cli,...args('verify')],{encoding:'utf8'});
    assert.equal(result.status,2);
    assert.deepEqual(JSON.parse(result.stdout).reasons,['SIGNATURE_INVALID']);
    assert.equal(result.stderr,'');
    assert.ok(!result.stdout.includes(dir));
    assert.ok(!result.stdout.includes(instances[0]));
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('invalid trust digest and unsafe CLI modes never print credentials or PEM', () => {
  assert.throws(()=>approvalSigningBytes({...fixture().approval,nonce:'x'}),
    /APPROVAL_SCHEMA_INVALID/);
  const sample=fixture();
  assert.throws(()=>verifySignedApproval({...sample,trustedKeySha256:'bad'}),
    /TRUST_ANCHOR_INVALID/);
  assert.throws(()=>parseProvenanceArgs(['--mode','audit','--ledger','relative.jsonl']),
    /INVALID_ARGUMENTS/);
  assert.equal(verifyLedger('').rows,0);
});
