# Manual publication of verified runtime and migration images to GHCR

This is an **operator-initiated, explicitly authorized** workflow to
publish existing, signed release candidates from
[release-artifacts.md](release-artifacts.md). It never builds new source,
runs migrations, modifies production Compose, rolls out Kubernetes, or
deploys the application.

## Prerequisites

1. Merge and verify the green **CI / required gates** on the specific
   source commit in **main**.
2. Run **Actions → Release candidate images and signed provenance** on
   `main`. Wait for **both** the package and independent verify job
   to succeed. Record that run's **numeric run ID** and full
   40-character source commit SHA.
3. Confirm the signed candidate archive is still available. GitHub
   Actions retains it for only **7 days**.
4. Ensure the repository's Actions permissions allow `GITHUB_TOKEN`
   to publish GHCR packages. The separate promotion job alone requests
   `packages: write`; no PAT or registry secret needs to be committed.
   New GHCR packages are initially **private** by default, even if the
   repository is public. Configure package visibility and access in
   GitHub Packages after deliberate review.
5. If GHCR packages with these names were created outside this
   repository, explicitly connect them to this repository's GitHub
   Actions access in package settings. A `packages: write` token
   cannot override missing package-level permissions.
6. Confirm neither tag already exists. The workflow independently
   checks for existing tags and **stops** rather than overwriting.

## Publish in GitHub Actions

Navigate to **Actions → Publish verified release candidate to GHCR**,
choose `main` and complete the three inputs:

- `release_run_id`: numeric ID of the successful signed release run.
- `source_sha`: that run's full source commit SHA.
- `confirm_publish`: select `PUBLISH_VERIFIED_CANDIDATE` instead
  of the default `NO_PUBLISH`, after approving publication.

The workflow rejects non-main dispatches, missing confirmation,
inconsistent release-run identity, failed/incomplete release runs
or a missing green required CI check for the exact source SHA.

Then it:

1. Downloads `gym-api-release-<SHA>-<release-run-id>` from the exact
   signed candidate run, **without** rebuilding any image.
2. Verifies the manifest's repository, source commit, `main` ref,
   run ID, image config IDs and SHA-256 of `images.tar.gz`.
3. Verifies **both GitHub attestations** using the repository, source
   SHA/ref and **release-artifacts workflow** as the signer policy.
4. Loads the archive, checks both images are non-root `node` and
   contain the correct source revision label/config ID.
5. Authenticates to GHCR with the temporary `GITHUB_TOKEN` and
   asks GHCR whether either destination tag already exists. Only
   an explicit **404** permits an initial push; errors such as 401,
   403, 429, timeouts, or missing scoped tokens **abort**.
6. Tags and pushes both images. It then pulls each from GHCR and
   compares the **remote image config ID** and revision labels
   with the verified release archive.
7. Writes the two digest references to the GitHub Actions job summary
   and retains `ghcr-digests.json` as a **30-day** evidence artifact.

### Image names

Both packages are namespaced to the repository owner:

```text
ghcr.io/sauron9521/gym-api-nestjs:sha-<SHA>-run-<release-run-id>
ghcr.io/sauron9521/gym-api-nestjs-migrate:sha-<SHA>-run-<release-run-id>
```

The exact runtime/migrate versions that matter for deployment are
**their returned digest references**:

```text
ghcr.io/sauron9521/gym-api-nestjs@sha256:<verified-registry-manifest-digest>
ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:<verified-registry-manifest-digest>
```

**Important:** the image config ID recorded in the signed archive is
**not** the same object as the GHCR registry manifest digest. The
workflow verifies both, then reports the **registry digest** for
immutable pulls. This does not claim byte-for-byte reproducibility
across future builds.

## What if publication partially succeeds?

GHCR image tags are **mutable by registry design**. A SHA/run-specific
tag and preflight 404 check protect against routine accidental
re-publication, but are **not a server-enforced immutability guarantee**:
an independently authorized client could race or overwrite it.

If the runtime push succeeds but migrate fails, the workflow fails.
Do **not** blindly rerun: the already-existing runtime tag triggers
a safe abort. Investigate the failure, confirm registry state and
perform an explicitly reviewed repair using a new candidate run or
other operator-approved remediation. No automatic deletion,
rollback or tag replacement is performed.

Always deploy by the returned `@sha256` digest. A change to a tag
cannot silently change the content addressed by that digest.
Keep the publication receipt in your restricted change records;
the uploaded artifact expires in 30 days.

## Security and verification limits

- The normal PR/push CI **never** has `packages: write`; only the
  operator-launched promotion job has it.
- No registry access, real GHCR login or push occurs in PR CI. Mock
  tests verify the source-run identity policy, token scoping,
  safe tag existence handling and post-publication digests.
- The release candidate source workflow was manual too, with its own
  independent signed verification job. **A green PR is not a signed
  release candidate**; create a separate release candidate run on
  `main` before promotion.
- Only `linux/amd64` images are provided. There is no multiarch
  manifest, production deployment approval, runtime rollout or automatic
  rollback. The signed release archive is validated before publication;
  promotion additionally signs the exact OCI digest and its SPDX SBOM.
  The release and promotion signer workflows serve distinct purposes.
- GitHub Actions workflow and GHCR package access must be limited to
  trusted maintainers. Protect `main`, audit package permissions, and
  pin the digests in any future production deployment.

Primary references:
[GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
and [verifying artifact attestations](https://cli.github.com/manual/gh_attestation_verify).


## Additional release supply-chain checks (PR #156)

Before publishing, Syft generates independent SPDX 2.3 SBOMs from the
two **already verified local Docker images**, then Grype scans each SBOM.
**Critical vulnerabilities, scanner failures and malformed evidence
block the push.** Both inventories and scan reports are retained for
30 days, including partial evidence when scanning fails.

Following publication and remote image-ID verification, GitHub
Attestations signs two artifact types **per exact GHCR manifest digest**:
promotion-workflow SLSA provenance and the SPDX SBOM. The workflow
re-verifies both attestation types with an exact repository, workflow
signer, main ref and execution commit. This publishing-workflow
signature **does not replace** the release-build archive signature.

GHCR cleanup remains opt-in, **read-only and human-reviewed**. See
[GHCR supply-chain verification and retention](ghcr-supply-chain.md)
for details, the 90-day/10-newest proposal, and an offline candidate
planner. No GHCR deletion permissions or automation are added.
