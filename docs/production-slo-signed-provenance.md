# SLO Evidence Provenance — Ed25519 signed review and local replay ledger (PR #145)

**Opt-in, offline, human-reviewed.** This complements the unsigned PR #143 evidence bundle and the PR #144 post-rollout drift tool. It cryptographically verifies a *detached Ed25519 signature* over a **specific change review** linked to the previously archived evidence and independently approved replica inventory.

This is **not** integration with any real change-ticket provider and does **not** itself authenticate a person's identity or prove that an organization's approval workflow occurred. The public-key owner, key permissions and independent ticket lifecycle must be validated by your organization. The CLI never sends network requests, enables alerts, deploys anything, uses Docker or updates Prometheus/Alertmanager.

## Secure workflow

1. Independently validate the PR #143 evidence bundle and the original inventory, then review the ticket in your organization-managed system. Compute the evidence SHA-256 with `npm run monitoring:slo-evidence -- --verify /private/path/CHG-12345.slo-evidence.json`. Compute the baseline inventory digest with `npm run monitoring:slo-postrollout -- --fingerprint-inventory /private/path/baseline-inventory.json --deployment production`.
2. An **authorized external signer** issues an Ed25519 signature. Keep the signing **private key entirely outside this repository and the verifier host**. The operator must obtain the signer's **public key** and its SPKI DER SHA-256 fingerprint over a *separately authenticated channel* (approved key registry or organization change policy). A fingerprint provided in the same untrusted email as an untrusted public key proves nothing.
3. Prepare an approval JSON based on `ops/monitoring/http-slo-signed-approval.example.json` (the committed example is unsigned and intentionally invalid). Include the exact `deployment`, safe `changeRef`, prior evidence and inventory SHA-256, `signerKeyId`, 16 cryptographically random bytes encoded as 32 lowercase hex characters in `nonce`, `approvedAt`, and `expiresAt`. A signature must expire at most **24 hours** after approval. The approved timestamp must follow evidence creation. This decision is **STAGING REVIEW EVIDENCE**, *not a production deployment approval*.
4. The signing service must sign the exact UTF-8 bytes **including the first line and newline**:

   `gym-api-slo-change-approval/v1` + newline + `JSON.stringify` of the approval object with this fixed property order:

   `version, domain, deployment, changeRef, evidenceSha256, inventorySha256, approvedAt, expiresAt, nonce, signerKeyId`.

   Use Ed25519 to produce a **64-byte detached signature** and store its **base64url (no padding)** encoding in a protected local file. Use a reviewed signing-service implementation — this repository deliberately does not include private-key generation, a signing CLI, key material or fabricated approvals.
5. An authorized operator runs the verifier using already protected local files and the independently pinned SHA-256 fingerprint:

~~~sh
npm run monitoring:slo-provenance -- \
  --mode verify \
  --evidence /var/lib/gym-api-slo/archive/CHG-12345.slo-evidence.json \
  --inventory /var/lib/gym-api-slo/archive/baseline-inventory.json \
  --approval /var/lib/gym-api-slo/private/CHG-12345.slo-approval.json \
  --signature /var/lib/gym-api-slo/private/CHG-12345.slo-signature \
  --public-key /etc/gym-api-slo/trusted-review-pubkey.pem \
  --trusted-key-sha256 YOUR_PINNED_64_CHARACTER_SPKI_SHA256 \
  --ledger /var/lib/gym-api-slo/private/approvals.slo-provenance.jsonl
~~~

`--mode verify` only reads files. A valid, unexpired, unrecorded signature reports `SIGNED_APPROVAL_VERIFIED_FOR_HUMAN_REVIEW` with exit code **0**; errors report `BLOCKED` and exit **2**. It does **not** consume an approval or create the ledger.

After independent human inspection, the operator can run **the same arguments** with `--mode record` to append exactly one approved entry. That mode reports `SIGNED_APPROVAL_RECORDED_FOR_HUMAN_REVIEW` and a new ledger head hash. Future `verify` or `record` attempts using the **same approval, evidence, nonce or deployment/change reference** are blocked with `APPROVAL_REPLAY_DETECTED`. This also prevents an expired approval from being reused: the expiry is rechecked for every verification or recording.

To check the local chain without contacting external services:

~~~sh
npm run monitoring:slo-provenance -- \
  --mode audit \
  --ledger /var/lib/gym-api-slo/private/approvals.slo-provenance.jsonl
~~~

`audit` verifies all rows' schema, sequence, previous hash linkage, entry hash and duplicate IDs. It fails if the ledger is missing, malformed or partially written. It reports `LOCAL_HASH_CHAIN_INTACT`, **not** independent approval authorization.

## What is cryptographically bound

The signed message carries the deployment, change ticket identifier, SHA-256 digest of the **entire** PR #143 evidence bundle, canonical SHA-256 digest of the authoritative per-deployment baseline inventory, Ed25519 signer key identifier, unique nonce, and explicit approval/expiry timestamps. The verifier checks that these values match the separately supplied evidence and baseline inventory, including the evidence's reviewed ticket and expected replica count. A valid signature from a different trusted key, a changed target, stale approval, modified evidence or altered decision context does **not** pass.

The public key must be Ed25519. The verifier compares the **SHA-256 of its DER SPKI bytes** against the independently trusted fingerprint supplied on the command line. The signing bytes include an explicit domain separator, preventing reuse as a signature for a different application protocol.

Local operator output includes only status, deployment, ticket reference, fixed-length digests, and non-sensitive booleans. It does **not** include raw target names, bearer secrets, private key material, Prometheus URLs, or actual inventory lists. Store all real operator files outside Git; the repository's `.gitignore` excludes their normal suffixes.

## Replay ledger: integrity and limitations

Recording uses a **local, restricted 0600, JSONL hash chain**; each row includes an immutable sequence number, previous row's SHA-256 hash, approval/evidence/inventory digests, signer SPKI digest and nonce. A separate exclusive `.lock` file ensures one cooperating process writes at a time. The final row hash should be **pinned into an independent, write-protected change ticket or audit system after every record**. An existing lock is never automatically discarded; investigate crashes and partially written rows before manually intervening.

**Do not mistake a local hash chain for tamper-proof storage.** Someone with write access to the whole ledger can replace the entire chain and hashes unless the latest head hash is independently anchored. A backup/restore of an old ledger can also remove replay history. For organization-wide or multi-host replay defense, use a centrally managed atomic, append-only authorization service; this tool is only a single-host local defense. Key compromise/revocation also requires a trusted organization key lifecycle outside this CLI. No private signing keys or simulated production approvals are included.

`authenticatedSignature:true` means the message matches the **pinned public key**, *not* that the named operator was personally authenticated or that a live ticket is approved. Every report explicitly marks `externalTicketStateChecked:false` and `productionAuthorized:false`.

## Verification and rollback

All tests are synthetic and offline: Ed25519 keys are generated **only in tests**; test cases cover the correct signature, altered evidence/replica identities, untrusted keys, changed signature bytes, expiry and clock skew, replay attempts, chained ledger writes, tampering, unsafe symlinks, lock contention and full CLI verify/record/audit flows. CI runs them under the required `npm run test:monitoring` step, with no production credentials and no external network.

Rollback: stop invoking the optional CLI. Preserve real signed approvals, original evidence and independent ledger head digests according to your organization's retention policy. Do not delete or truncate a replay ledger to "fix" a conflict. This PR does not modify the existing unsigned post-rollout diagnostic tool; it adds an independent, **stronger cryptographic evidence check** which must be followed by normal human approval and separate change-management procedures.
