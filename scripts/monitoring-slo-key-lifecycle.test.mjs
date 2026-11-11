import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { PREFLIGHT_METRICS } from './monitoring-slo-preflight.mjs';
import {
  createEvidenceBundle, REQUIRED_CONFIRMATIONS,
} from './monitoring-slo-rollout-evidence.mjs';
import { inventoryFingerprint } from './monitoring-slo-postrollout.mjs';
import {
  approvalSigningBytes, recordVerifiedApproval, verifyLedger,
} from './monitoring-slo-provenance.mjs';
import {
  KeyLifecycleError, policySigningBytes, verifySignedPolicy,
  validatePolicyTransition, trustedSignerFromPolicy,
  verifyPolicyApproval, verifyAnchoredLedger, parseKeyLifecycleArgs,
} from './monitoring-slo-key-lifecycle.mjs';

const epoch = Date.parse('2026-11-11T19:00:00.000Z');
const iso = ms=>new Date(ms).toISOString();
const ZERO = '0'.repeat(64);
const hash = bytes=>createHash('sha256').update(bytes).digest('hex');
const fp = key=>hash(key.export({format:'der',type:'spki'}));
const keys = ()=>generateKeyPairSync('ed25519');
const clone = obj=>structuredClone(obj);

function makeFixture(now=epoch, changeRef='CHG-146-ROTATION') {
  const root=keys(), signer=keys();
  const inventory={
    version:1,scrapeIntervalSeconds:30,
    deployments:[{name:'production',instances:['api-a.internal:8443','api-b.internal:8443']}],
  };
  const checks=Object.fromEntries(PREFLIGHT_METRICS.map(metric=>[
    metric.split(':').at(-1),
    metric.includes('coverage') || metric.endsWith('scrape_success_30d') ? 0.997 :
      metric.endsWith('availability_verified_30d') ? 0.999 :
        metric.endsWith('error_budget_consumed_verified_30d') ? 1 : 1,
  ]));
  const preflight={
    version:1, checkedAt:iso(now-240_000),deployment:'production',
    status:'READY_FOR_REVIEW',expectedReplicas:2,observedReplicas:2,
    checks,reasons:[],
  };
  const review={
    version:1,deployment:'production',reviewer:'operator-01',
    reviewedAt:iso(now-180_000),changeRef,
    decision:'REVIEWED_FOR_STAGING',
    confirmations:Object.fromEntries(REQUIRED_CONFIRMATIONS.map(k=>[k,true])),
  };
  const evidence=createEvidenceBundle(preflight,review,now-120_000);
  const evidenceHash=hash(JSON.stringify(evidence));
  const approval={
    version:1,domain:'gym-api-slo-change-approval/v1',deployment:'production',
    changeRef,decision:'STAGING_ROLLOUT_REVIEWED',
    evidenceSha256:evidenceHash,
    inventorySha256:inventoryFingerprint(inventory,'production').sha256,
    approvedAt:iso(now-60_000),expiresAt:iso(now+3600_000),
    nonce:'a'.repeat(32),signerKeyId:'staging-approver-01',
  };
  const signature=sign(null,approvalSigningBytes(approval),signer.privateKey)
    .toString('base64url');
  const signingKey={
    keyId:'staging-approver-01',fingerprintSha256:fp(signer.publicKey),
    deployments:['production'],validFrom:iso(now-86400_000),
    validUntil:iso(now+2*86400_000),state:'active',disabledAt:null,
  };
  const policy={
    version:1,domain:'gym-api-slo-key-policy/v1',sequence:1,
    issuedAt:iso(now-600_000),expiresAt:iso(now+86400_000),
    previousPolicySha256:ZERO,keys:[signingKey],
  };
  const rootPem=root.publicKey.export({format:'pem',type:'spki'});
  const signerPem=signer.publicKey.export({format:'pem',type:'spki'});
  const signPolicy=policy=>sign(null,policySigningBytes(policy),root.privateKey)
    .toString('base64url');
  const policyInputs={
    policy,signature:signPolicy(policy),rootPublicKeyPem:rootPem,
    trustedRootSha256:fp(root.publicKey),
    trustedPolicySha256:hash(policySigningBytes(policy)),
    trustedPolicySequence:1,
  };
  return {now,root,signer,inventory,evidence,approval,signature,
    rootPem,signerPem,policy,signingKey,policyInputs,signPolicy};
}

test('root-signed policy and scoped approved Ed25519 key verify without production authorization',()=>{
  const f=makeFixture();
  const verifiedPolicy=verifySignedPolicy({...f.policyInputs,nowMs:f.now});
  assert.equal(verifiedPolicy.sequence,1);
  assert.equal(verifiedPolicy.rootSha256,f.policyInputs.trustedRootSha256);
  assert.equal(trustedSignerFromPolicy(verifiedPolicy,f.approval,f.now),
    f.signingKey.fingerprintSha256);
  const result=verifyPolicyApproval({
    policyInputs:f.policyInputs,approval:f.approval,
    signature:f.signature,signerPublicKeyPem:f.signerPem,
    evidence:f.evidence,inventory:f.inventory,nowMs:f.now,
  });
  assert.equal(result.verified.authenticatedSignature,true);
  assert.equal(result.verified.productionAuthorized,false);
  assert.equal(result.verified.externalTicketStateChecked,false);
  assert.equal(result.verified.signerKeySha256,f.signingKey.fingerprintSha256);
});

test('root pins, policy digest/sequence and detached root signature fail closed',()=>{
  const f=makeFixture();
  const patches=[
    {trustedRootSha256:'f'.repeat(64)},
    {trustedPolicySha256:'f'.repeat(64)},
    {trustedPolicySequence:2},
    {signature:'A'.repeat(86)},
    {signature:f.policyInputs.signature.slice(0,-1)+'!'},
    {rootPublicKeyPem:'NOT A PEM'},
    {policy:{...f.policy,domain:'untrusted/v1'}},
    {policy:{...f.policy,previousPolicySha256:'f'.repeat(64)}},
    {policy:{...f.policy,keys:[{...f.signingKey,deployments:['production','production']}]}},
    {policy:{...f.policy,keys:[{...f.signingKey,disabledAt:iso(f.now-5_000)}]}},
    {policy:{...f.policy,sequence:2}},
    {policy:{...f.policy,expiresAt:iso(f.now+35*86400_000)}},
  ];
  for(const patch of patches)assert.throws(
    ()=>verifySignedPolicy({...f.policyInputs,...patch,nowMs:f.now}),
    KeyLifecycleError,
  );
  assert.throws(()=>verifySignedPolicy({
    ...f.policyInputs,nowMs:f.now+2*86400_000,
  }),/POLICY_EXPIRED_OR_FUTURE/);
});

test('rotation preserves old key history but blocks new approvals signed by retired key',()=>{
  const f=makeFixture();
  const old=verifySignedPolicy({...f.policyInputs,nowMs:f.now});
  const newSigner=keys();
  const retired={...f.signingKey,state:'retired',disabledAt:iso(f.now-120_000)};
  const newKey={
    keyId:'staging-approver-02',fingerprintSha256:fp(newSigner.publicKey),
    deployments:['production'],validFrom:iso(f.now-300_000),
    validUntil:iso(f.now+2*86400_000),state:'active',disabledAt:null,
  };
  const nextPolicy={
    ...f.policy,sequence:2,issuedAt:iso(f.now-60_000),
    previousPolicySha256:old.policySha256,keys:[retired,newKey],
  };
  const nextInputs={
    ...f.policyInputs,policy:nextPolicy,signature:f.signPolicy(nextPolicy),
    trustedPolicySequence:2,
    trustedPolicySha256:hash(policySigningBytes(nextPolicy)),
  };
  const next=verifySignedPolicy({...nextInputs,nowMs:f.now});
  assert.equal(validatePolicyTransition(old,next).valid,true);
  assert.throws(()=>verifyPolicyApproval({
    policyInputs:nextInputs,approval:f.approval,
    signature:f.signature,signerPublicKeyPem:f.signerPem,
    evidence:f.evidence,inventory:f.inventory,nowMs:f.now,
  }),/SIGNER_RETIRED_OR_REVOKED/);
  const newApproval={...f.approval,signerKeyId:newKey.keyId};
  const signature=sign(null,approvalSigningBytes(newApproval),newSigner.privateKey)
    .toString('base64url');
  const allowed=verifyPolicyApproval({
    policyInputs:nextInputs,approval:newApproval,signature,
    signerPublicKeyPem:newSigner.publicKey.export({format:'pem',type:'spki'}),
    evidence:f.evidence,inventory:f.inventory,nowMs:f.now,
  });
  assert.equal(allowed.verified.signerKeySha256,newKey.fingerprintSha256);
  assert.equal(allowed.verifiedPolicy.sequence,2);
});

test('revocation, scope changes, fingerprint substitution and key resurrection fail closed',()=>{
  const f=makeFixture();
  const previous=verifySignedPolicy({...f.policyInputs,nowMs:f.now});
  const revoked={
    ...f.signingKey,state:'revoked',disabledAt:iso(f.now-120_000),
  };
  const policy2={
    ...f.policy,sequence:2,issuedAt:iso(f.now-60_000),
    previousPolicySha256:previous.policySha256,keys:[revoked],
  };
  const inputs={
    ...f.policyInputs,policy:policy2,signature:f.signPolicy(policy2),
    trustedPolicySha256:hash(policySigningBytes(policy2)),trustedPolicySequence:2,
  };
  const verified=verifySignedPolicy({...inputs,nowMs:f.now});
  assert.equal(validatePolicyTransition(previous,verified).valid,true);
  assert.throws(()=>trustedSignerFromPolicy(verified,f.approval,f.now),
    /SIGNER_RETIRED_OR_REVOKED/);
  const corrupted=[
    {...policy2,previousPolicySha256:'f'.repeat(64)},
    {...policy2,keys:[{...revoked,state:'active',disabledAt:null}]},
    {...policy2,keys:[{...revoked,deployments:['staging']}]},
    {...policy2,keys:[{...revoked,fingerprintSha256:'f'.repeat(64)}]},
  ];
  assert.throws(
    ()=>policySigningBytes({...policy2,keys:[]}),
    /POLICY_SCHEMA_INVALID/,
  );
  for(const candidate of corrupted) {
    const checked=verifySignedPolicy({
      ...inputs,policy:candidate,signature:f.signPolicy(candidate),
      trustedPolicySha256:hash(policySigningBytes(candidate)),nowMs:f.now,
    });
    assert.throws(()=>validatePolicyTransition(previous,checked),KeyLifecycleError);
  }
  const policy3={
    ...policy2,sequence:3,issuedAt:iso(f.now),
    previousPolicySha256:verified.policySha256,
    keys:[{...revoked,state:'active',disabledAt:null}],
  };
  const third=verifySignedPolicy({
    ...inputs,policy:policy3,signature:f.signPolicy(policy3),
    trustedPolicySha256:hash(policySigningBytes(policy3)),trustedPolicySequence:3,
    nowMs:f.now,
  });
  assert.throws(()=>validatePolicyTransition(verified,third),
    /POLICY_REACTIVATION_FORBIDDEN/);
  const stageApproval={...f.approval,deployment:'staging'};
  assert.throws(()=>trustedSignerFromPolicy(previous,stageApproval,f.now),
    /SIGNER_OUT_OF_SCOPE_OR_WINDOW/);
});

test('anchored ledger head catches rollback and unanchored append while retaining history',()=>{
  const f=makeFixture();
  const dir=mkdtempSync(join(tmpdir(),'gym-api-key-lifecycle-ledger-'));
  try{
    const path=join(dir,'approvals.slo-provenance.jsonl');
    const verified=verifyPolicyApproval({
      policyInputs:f.policyInputs,approval:f.approval,signature:f.signature,
      signerPublicKeyPem:f.signerPem,evidence:f.evidence,inventory:f.inventory,
      nowMs:f.now,
    }).verified;
    const first=recordVerifiedApproval(path,verified,f.now,{
      rows:0,headSha256:ZERO,
    });
    const state=verifyAnchoredLedger(readFileSync(path,'utf8'),1,first.headSha256);
    assert.equal(state.rows,1);
    assert.throws(()=>verifyAnchoredLedger(readFileSync(path,'utf8'),0,ZERO),
      /LEDGER_ANCHOR_MISMATCH/);
    assert.throws(()=>recordVerifiedApproval(path,verified,f.now+1,{
      rows:0,headSha256:ZERO,
    }),/LEDGER_CHECKPOINT_MISMATCH/);
    const lines=readFileSync(path,'utf8');
    assert.throws(()=>verifyAnchoredLedger(lines.replace(verified.changeRef,'CHG-FAKE'),1,first.headSha256),
      /LEDGER_INVALID/);
    assert.throws(()=>verifyAnchoredLedger(lines,1,'f'.repeat(64)),
      /LEDGER_ANCHOR_MISMATCH/);
    assert.throws(()=>verifyAnchoredLedger(lines,NaN,first.headSha256),
      /LEDGER_ANCHOR_INVALID/);
    assert.equal(verifyLedger(lines).rows,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('CLI verifies root-signed approval, records once, validates external tip and rejects replay',()=>{
  const dir=mkdtempSync(join(tmpdir(),'gym-api-key-lifecycle-cli-'));
  const script=new URL('./monitoring-slo-key-lifecycle.mjs',import.meta.url).pathname;
  try{
    const f=makeFixture(Date.now());
    const paths={
      ledger:join(dir,'approvals.slo-provenance.jsonl'),
      policy:join(dir,'policy.slo-key-policy.json'),
      policySignature:join(dir,'policy.slo-policy-signature'),
      rootPublicKey:join(dir,'policy-root.pub.pem'),
      evidence:join(dir,'baseline.slo-evidence.json'),
      inventory:join(dir,'inventory.slo-baseline-inventory.json'),
      approval:join(dir,'approval.slo-approval.json'),
      signature:join(dir,'approval.slo-signature'),
      signerPublicKey:join(dir,'signer.pub.pem'),
    };
    for(const key of Object.keys(paths)) {
      if(key==='ledger')continue;
      writeFileSync(paths[key],
        ['policy','evidence','inventory','approval'].includes(key) ?
          JSON.stringify(f[key]) :
          key==='policySignature'?f.policyInputs.signature :
          key==='rootPublicKey'?f.rootPem :
          key==='signerPublicKey'?f.signerPem :
          f.signature,
      );
    }
    const cli=(mode,rows,head)=>[
      '--mode',mode,'--ledger',paths.ledger,
      '--trusted-ledger-sequence',String(rows),
      '--trusted-ledger-head-sha256',head,
      ...(mode==='audit'?[]:[
        '--policy',paths.policy,
        '--policy-signature',paths.policySignature,
        '--root-public-key',paths.rootPublicKey,
        '--trusted-root-sha256',f.policyInputs.trustedRootSha256,
        '--trusted-policy-sha256',f.policyInputs.trustedPolicySha256,
        '--trusted-policy-sequence','1',
        '--evidence',paths.evidence,'--inventory',paths.inventory,
        '--approval',paths.approval,'--signature',paths.signature,
        '--signer-public-key',paths.signerPublicKey,
      ]),
    ];
    assert.equal(parseKeyLifecycleArgs(cli('verify',0,ZERO)).mode,'verify');
    let response=spawnSync(process.execPath,[script,...cli('verify',0,ZERO)],{
      encoding:'utf8',
    });
    assert.equal(response.status,0,response.stdout+response.stderr);
    assert.equal(JSON.parse(response.stdout).status,
      'KEY_POLICY_APPROVAL_VERIFIED_FOR_HUMAN_REVIEW');
    assert.ok(!existsSync(paths.ledger));

    response=spawnSync(process.execPath,[script,...cli('record',0,ZERO)],{
      encoding:'utf8',
    });
    assert.equal(response.status,0,response.stdout+response.stderr);
    const recorded=JSON.parse(response.stdout);
    assert.equal(recorded.status,'KEY_POLICY_APPROVAL_RECORDED_FOR_HUMAN_REVIEW');
    assert.equal(recorded.ledgerRows,1);
    assert.ok(existsSync(paths.ledger));
    assert.ok(!response.stdout.includes('api-a.internal'));

    const audit=spawnSync(process.execPath,[
      script,...cli('audit',1,recorded.ledgerHeadSha256),
    ],{encoding:'utf8'});
    assert.equal(audit.status,0,audit.stdout+audit.stderr);
    assert.equal(JSON.parse(audit.stdout).status,
      'LEDGER_HEAD_MATCHES_INDEPENDENT_PIN');
    assert.equal(JSON.parse(audit.stdout).pinProvenanceChecked,false);

    const replay=spawnSync(process.execPath,[
      script,...cli('verify',1,recorded.ledgerHeadSha256),
    ],{encoding:'utf8'});
    assert.equal(replay.status,2);
    assert.deepEqual(JSON.parse(replay.stdout).reasons,['APPROVAL_REPLAY_DETECTED']);

    const rollback=spawnSync(process.execPath,[
      script,...cli('verify',0,ZERO),
    ],{encoding:'utf8'});
    assert.equal(rollback.status,2);
    assert.deepEqual(JSON.parse(rollback.stdout).reasons,['LEDGER_ANCHOR_MISMATCH']);

    const badPin=spawnSync(process.execPath,[
      script,...cli('verify',1,recorded.ledgerHeadSha256).map(
        v=>v===f.policyInputs.trustedPolicySha256?'f'.repeat(64):v,
      ),
    ],{encoding:'utf8'});
    assert.equal(badPin.status,2);
    assert.deepEqual(JSON.parse(badPin.stdout).reasons,['POLICY_ROLLBACK_OR_MISMATCH']);
    assert.equal(badPin.stderr,'');
    assert.ok(!badPin.stdout.includes(dir));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('argument validation is strict, policy template is unsigned, and ledger audit needs an anchor',()=>{
  const example=JSON.parse(readFileSync(new URL(
    '../ops/monitoring/http-slo-key-policy.example.json',import.meta.url,
  ),'utf8'));
  assert.throws(()=>policySigningBytes(example),KeyLifecycleError);
  assert.throws(()=>parseKeyLifecycleArgs(['--mode','audit','--ledger','relative.jsonl']),
    /INVALID_ARGUMENTS/);
  assert.throws(()=>parseKeyLifecycleArgs([
    '--mode','audit','--ledger','/tmp/x.jsonl',
    '--trusted-ledger-sequence','0',
    '--trusted-ledger-head-sha256',ZERO,
    '--trusted-ledger-head-sha256',ZERO,
  ]),/INVALID_ARGUMENTS/);
});
