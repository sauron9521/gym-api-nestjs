# GHCR supply-chain evidence and retention policy (PR #156)

This extends the **manual, authorized** [GHCR publishing workflow](ghcr-promotion.md).
The application is never deployed, migrated, retagged or deleted automatically.
The original [signed release candidate](release-artifacts.md) must have passed
both its independent jobs before publication is even offered.

## 1. Inventory and vulnerability scanning before registry push

The publishing workflow loads the two verified Docker images from the
**signed release archive**. Before any `docker push`, it:

1. Runs Syft via `anchore/sbom-action@v0` against each local image,
   generating independent SPDX 2.3 inventories in
   `release/runtime.spdx.json` and `release/migrate.spdx.json`.
2. Uses Grype via `anchore/scan-action@v7` to scan **both** inventories,
   outputting `runtime.grype.json` and `migrate.grype.json`.
3. Blocks publication on **critical-severity** findings. Grype download,
   vulnerability database or scan errors also block publication; missing
   results do **not** mean zero vulnerabilities.
4. Checks that the SPDX inventories are nonempty, and that the scanner
   reports are valid Grype JSON. This format validator does not override
   the scanner's own severity enforcement.
5. Uploads SBOM, scan JSON and summaries as a **30-day** Actions artifact.
   Reports are saved even when a scan fails, if available.

Grype's advisory database changes over time. A previously signed candidate
may be blocked later. Do not bypass the gate: review advisories, update
Node base image or vulnerable dependencies, rebuild a new signed candidate,
and repeat scanning. High/medium findings are reported but are not blocking
in this initial rollout—this is a policy choice, not evidence of safety.

## 2. Registry digest provenance and SBOM attestations

After publishing, the existing workflow pulls both images and validates
their Docker **image config IDs**, non-root user and revision labels against
the signed archive. The **GHCR manifest digest** is a separate identifier
from the image config ID. Only the GHCR `@sha256` digest is appropriate
for immutable pulls.

The workflow then uses `actions/attest@v4` to sign two independent
attestation types for **each exact GHCR digest**:

- `https://slsa.dev/provenance/v1` — a statement identifying the
  **manual publishing workflow**, its own checked-out `main` commit and
  GitHub identity. This is a *promotion* signature, not a claim that the
  publication job originally built the image.
- `https://spdx.dev/Document/v2.3` — the generated SPDX SBOM describing
  that image from the signed archive.

Attestations are published to GHCR via `push-to-registry: true`. The
workflow independently verifies both predicate types on **both**
`oci://ghcr.io/OWNER/IMAGE@sha256:DIGEST` subjects, restricting signer
to this repository's `publish-ghcr.yml`, the `main` ref and publishing
commit. The previous `release-artifacts.yml` signature verifies the
original archive separately. **Both trust checks matter.**

Manual verification after authenticating to GHCR (repeat for migrate):

```bash
gh attestation verify \
  oci://ghcr.io/sauron9521/gym-api-nestjs@sha256:REPLACE_WITH_REAL_DIGEST \
  --repo sauron9521/gym-api-nestjs \
  --signer-workflow sauron9521/gym-api-nestjs/.github/workflows/publish-ghcr.yml \
  --source-ref refs/heads/main \
  --source-digest PUBLISH_WORKFLOW_COMMIT_SHA \
  --predicate-type https://slsa.dev/provenance/v1

gh attestation verify \
  oci://ghcr.io/sauron9521/gym-api-nestjs@sha256:REPLACE_WITH_REAL_DIGEST \
  --repo sauron9521/gym-api-nestjs \
  --signer-workflow sauron9521/gym-api-nestjs/.github/workflows/publish-ghcr.yml \
  --source-ref refs/heads/main \
  --source-digest PUBLISH_WORKFLOW_COMMIT_SHA \
  --predicate-type https://spdx.dev/Document/v2.3
```

The source digest for this *promotion* verification is the commit that
ran `publish-ghcr.yml`, not necessarily the archived image's earlier
source commit. Cryptographic signing authenticates source and workflow
identity; it does not prove the image has no vulnerabilities. A registry
tag remains mutable. Always deploy with an exact `@sha256` reference.

An OCI push can succeed while attestation fails, for example due to
GHCR permissions or a transient signing service issue. In that case
the workflow is **red** despite existing images. Do not blindly rerun
with the same SHA/run tags: GHCR preflight refuses overwrites. Escalate
to an operator, preserve logs, and approve a fresh candidate or a
separately reviewed recovery procedure.

## 3. Proposed GHCR retention — report only, no deletion

Suggested conservative starting rules for **each** of the two packages:

- Retain the **10 newest versions**, irrespective of tag state or age.
- Retain all **tagged versions** and versions younger than **90 days**.
- Retain all **actively deployed, standby, rollback and audit/legal hold**
  digests even when untagged, regardless of their age.
- Only versions that are **untagged, older than 90 days, not protected,
  and not among the newest 10** become review candidates.
- Do not delete any version unless an authorized operator separately
  verifies deployment manifests, rollback plans, GHCR package ownership
  and a complete paginated inventory.

An **offline read-only** planner `scripts/ghcr-retention-plan.mjs`
enforces these filters and refuses missing active-digest allowlists.
It has **no delete implementation, GitHub API client, registry writes
or schedule**. Do not enable `delete:packages` permissions in CI.

To collect inventory with a read-only, package-capable GitHub credential:

```bash
gh api --paginate --slurp \
  "users/sauron9521/packages/container/gym-api-nestjs/versions?per_page=100" \
  > runtime-versions.json
gh api --paginate --slurp \
  "users/sauron9521/packages/container/gym-api-nestjs-migrate/versions?per_page=100" \
  > migrate-versions.json
```

Create an **untracked** `protected-digests.json` with the actual currently
deployed and rollback-safe GHCR manifest digests (at least one per type):

```json
{
  "runtime": ["sha256:REPLACE_WITH_64_HEX_DIGEST"],
  "migrate": ["sha256:REPLACE_WITH_64_HEX_DIGEST"]
}
```

Substitute real 64-character lowercase hex digests; these placeholders
are invalid intentionally. Generate a **review-only** candidate report:

```bash
node scripts/ghcr-retention-plan.mjs \
  runtime-versions.json migrate-versions.json \
  protected-digests.json "$(date -u +%F)" > ghcr-retention-review.json
```

The report includes candidate version IDs and timestamps, **not**
deletion commands. It must be checked against complete inventories
and active deployment/rollback references. GitHub Actions will never
delete, retag, prune or rotate packages on your behalf under this PR.

This policy deliberately favors disk/storage cost over the risk of
removing a production rollback path. Future registry cleanup
automation requires separate explicit approval and dedicated tests.

## References

- [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [Syft](https://github.com/anchore/syft) and [Grype](https://github.com/anchore/grype)
- [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)


## Security remediation: Debian 12 to Debian 13 (CVE-2026-5450)

On 2026-11-12, the first publication under the new Grype policy
stopped **before the registry push** because the signed runtime image
based on `node:22-bookworm-slim` contained two critical findings
for `CVE-2026-5450`: `libc6` and `libc-bin`, both at
`2.36-9+deb12u14`.

The [Debian Security Tracker](https://security-tracker.debian.org/tracker/CVE-2026-5450)
still reports Debian 12 Bookworm as vulnerable, while Debian 13
Trixie has fixed glibc starting at `2.41-12+deb13u4`.
Accordingly, we switched the **common Node 22 builder and runtime**
to `node:22-trixie-slim`. The release workflow continues to resolve
an immutable base digest at build time, and both images use that base.
CI checks the effective distro and installed `libc6` package version
on **both** images. It also scans both actual CI images with Grype,
blocking on critical findings before PR merge. The GHCR promotion scan
remains the final gate, as the vulnerability database and base-image
digest can change between CI and manual publication.

**Do not retry the blocked release archive:** it preserves the
unpatched Bookworm packages. After this PR merges and main CI is green,
create a **new** signed Release Candidate, then run manual publication
with its **new run ID and source SHA**. Preserve the earlier failure
report and audit trail. No severity downgrade, CVE suppression or
automatic registry overwrite has been introduced.
