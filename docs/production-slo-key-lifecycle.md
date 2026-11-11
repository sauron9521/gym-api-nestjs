# SLO signing key lifecycle: root-signed policy, revocation, rotation and anchored audit (PR #146)

**Offline, opt-in, staging-review only.** PR #145 verifies a detached Ed25519 signature pinned to one key but cannot automatically detect that the key was later retired or revoked; a local replay ledger also cannot detect complete rollback without independently anchored checkpoints. This PR adds an **independently root-signed, version-pinned key policy**, signer scope checks and an **exact, externally pinned ledger head**. No automatic deployments, alerts, notifications, ticket changes or production authorization are performed.

## Trust prerequisites

Before trusting a policy, an operator MUST obtain the **root Ed25519 public key fingerprint** (SHA-256 over DER SPKI), the **current policy signing digest**, and **current policy sequence** from a *separately authenticated and write-protected source* (e.g. approved change management). This repository does not supply those real trust anchors, signing keys or private root signing service.

The policy JSON is signed by an **offline or organization-controlled root private key**. Never store that private key in the Git repository, CLI host or CI. Check the manifest schema against `ops/monitoring/http-slo-key-policy.example.json`; the checked-in example contains invalid placeholders and is **not** trusted by default.

The Ed25519 signing input is **exactly** the UTF-8 bytes:

`gym-api-slo-key-policy/v1` + newline + `JSON.stringify` of an object with top-level fields in this strict order:

`version, domain, sequence, issuedAt, expiresAt, previousPolicySha256, keys`.

Each array item uses exactly this field order:

`keyId, fingerprintSha256, deployments, validFrom, validUntil, state, disabledAt`.

Use sorted, unique `keyId` values, and sorted, explicit deployment scopes (no wildcard). Every key's fingerprint is SHA-256 of its Ed25519 public key DER SPKI. Only **public** key fingerprints belong in the manifest. Policy lifetime is at most **30 days**. The first version has `sequence=1` and `previousPolicySha256` equal to 64 zeros; every later version must refer to the prior **signing-bytes SHA-256**.

The signer creates a **detached 64-byte Ed25519 signature**, saved as unpadded base64url. The policy digest and sequence **must also be pinned independently**: a valid signature by itself does not prevent replay of an old but valid policy after revocation.

## Rotation and revocation

To rotate, the organization issues a newer root-signed policy:

- Increase `sequence` by exactly one and set `previousPolicySha256` to the prior policy's verified digest. Do not silently edit a previously published policy.
- Keep the old key ID, fingerprint, deployment scope and validity interval unchanged. Change its `state` from `active` to `retired` with a real `disabledAt` UTC timestamp, and add the new active key under a **new keyId** and fingerprint.
- After disabling or retiring the old key, **new approval verification fails** with `SIGNER_RETIRED_OR_REVOKED`. Historical already-recorded, independently anchored ledger entries remain accessible for forensic review; their prior signature is not represented as a currently valid authorization.
- For a compromised key use `revoked` rather than `retired`. Revocation **takes effect when the verifier uses the current signed policy**. A revoked ID cannot be reactivated; use a fresh key. If the root key is compromised, this design is not enough: stop trusting its policies and use the organization's independently approved root recovery procedure.

The exported `validatePolicyTransition(previous,next)` also checks sequential versions, immutable old-key identity, no missing old keys, no reactivation and consistent chain linkage. CI tests all such transitions. For actual operations, review both authenticated versions and their pinned digests through your existing change-management procedure. This PR intentionally **does not** install an unattended policy updater, because discovering a new policy from the same untrusted source that provides its digest would defeat the anti-rollback property.

A signer's **new approval** can be accepted only when the key is `active` and its approved/expiry timestamps and current verification time are within its validity window and explicit deployment scope. Key status is enforced **before** the existing PR #145 Ed25519 approval verification. The old direct-pin PR #145 command remains available for backwards compatibility and **does not enforce this new revocation registry**. For production-relevant review, require the new lifecycle command in the organization-controlled workflow and restrict direct-pin bypass by policy and access controls.

## Independently anchored replay ledger

Before any verify/record/audit operation, supply the last **externally stored ledger sequence and head SHA-256**. The CLI reads the entire local hash chain and requires the **exact** sequence and head to match. A missing ledger may be trusted only if the independent anchor is the explicitly approved initial state, `0` rows and 64 zero hex characters. That initial empty-state anchor must never be reused after your first record.

For every successful `record`, the tool enforces the prior head **again inside the exclusive writer lock**, then appends one new row, fsyncs it, and prints the **new** sequence and head. The operator MUST immediately record those values in independent, protected change management. A following attempt with the old anchor fails. A ledger hash chain only protects the history to the **last independently recorded head**; a malicious actor could rewrite or delete unanchored entries. Key and replay state cannot be guaranteed across multiple hosts without a centrally controlled, transactional authorization service.

Do **not** clear existing `.lock` files or delete/recreate a journal to overcome a failure. Investigate the original process, check the last externally pinned sequence and head, and follow your incident/restore procedure. Both the policy and ledger anchors are operator supplied; **the CLI cannot authenticate the origin of those inputs**.

## Read-only verify, explicit record, and anchored audit

After privately provisioning all **real** files, use the following placeholders as a guide:

~~~sh
npm run monitoring:slo-keys -- \
  --mode verify \
  --policy /private/slo/policy.slo-key-policy.json \
  --policy-signature /private/slo/policy.slo-policy-signature \
  --root-public-key /etc/slo/policy-root.pub.pem \
  --trusted-root-sha256 PINNED_ROOT_SPKI_SHA256 \
  --trusted-policy-sha256 PINNED_POLICY_SIGNING_BYTES_SHA256 \
  --trusted-policy-sequence 2 \
  --evidence /private/slo/CHG-12345.slo-evidence.json \
  --inventory /private/slo/baseline.slo-baseline-inventory.json \
  --approval /private/slo/CHG-12345.slo-approval.json \
  --signature /private/slo/CHG-12345.slo-signature \
  --signer-public-key /etc/slo/approver.pub.pem \
  --ledger /private/slo/approvals.slo-provenance.jsonl \
  --trusted-ledger-sequence 1 \
  --trusted-ledger-head-sha256 PINNED_EXTERNAL_LEDGER_HEAD_SHA256
~~~

`--mode verify` performs no writes and returns `KEY_POLICY_APPROVAL_VERIFIED_FOR_HUMAN_REVIEW`, exit **0**, only when all signatures, root/policy pins, scope, time, evidence, replica inventory and ledger anchor/replay checks pass. `--mode record` uses the same options but appends the entry to the local replay ledger, returning the newly generated anchor. Do **not** automatically feed that new anchor into the next run without separately recording and validating it in your trusted change-management system.

To audit the local ledger against the independently stored exact head:

~~~sh
npm run monitoring:slo-keys -- \
  --mode audit \
  --ledger /private/slo/approvals.slo-provenance.jsonl \
  --trusted-ledger-sequence 1 \
  --trusted-ledger-head-sha256 PINNED_EXTERNAL_LEDGER_HEAD_SHA256
~~~

The status is `LEDGER_HEAD_MATCHES_INDEPENDENT_PIN` when successful. All failures return `BLOCKED` with a fixed reason code and exit **2**; raw file paths, replica identities, secrets, public/private key contents and server responses are excluded from normal JSON output. Invalid/missing/unsigned policy, replaced public keys, wrong root/policy pins, rollback, expired or revoked keys, stale approvals, altered evidence or inventory, replayed approvals and partial/corrupt ledgers fail closed.

**Do not treat these results as production approval.** Even a verified Ed25519 signature proves only that the signed bytes came from the pinned public key, not that its owner is still authorized in a live ticket system. Output always includes `externalTicketStateChecked:false` and `productionAuthorized:false`. The ledger audit does not re-verify each past signing key; it checks the independently anchored local chain.

## Test and rollout

The required `npm run test:monitoring` suite includes `scripts/monitoring-slo-key-lifecycle.test.mjs`. It generates ephemeral **test-only** Ed25519 keys and proves root signature validity, rotation, refusal of retired and revoked keys, no resurrection, policy anti-rollback, insufficient trust pin, strict deployment/time scoping, exact external ledger anchoring, pinned-head verification inside the writer lock, privacy-safe CLI verify/record/audit, and failed replay attempts. No real root keys, tickets, Prometheus endpoints or production credentials are accessed.

Roll out first in offline staging, with an independently managed root key, policy/digest version, trusted key registry, archived approvals, and an immutable audit-head record in a separate secured system. Ensure operators know how to handle missing logs, interrupted writes, revoked keys and root compromise. Do not enable production alerts, automate rollouts or bypass change reviews based on this script.

Rollback: stop using this optional lifecycle command; preserve existing signed policies, evidence bundles and anchored ledger under your retention rules. Never erase replay history as a rollback shortcut. No application database or production infrastructure modifications are included.
