# Signed release candidate artifacts (PR #154)

The opt-in `.github/workflows/release-artifacts.yml` creates an
**immutable, verifiable release candidate** of the runtime and migration
Docker images. It does **not** automatically publish to a registry,
create a release, run migrations, update `compose.prod.yml` or deploy.

## Trust and build prerequisites

- Start the workflow manually with **Actions → Release candidate images and
  signed provenance → Run workflow** and select `main`.
- The release workflow refuses all refs except `refs/heads/main` and
  checks that the exact `GITHUB_SHA` already has a completed, green
  `CI / required gates` check. If main CI is not finished, the
  workflow fails closed; rerun once CI has succeeded.
- Only the **package job** receives OIDC/attestation permissions.
  The independent **verify job** has read-only permissions.
- GitHub-hosted `ubuntu-latest` runs the build with Node 22 and
  Docker `linux/amd64`. Both Docker images are built from the same
  resolved `node:22-bookworm-slim` immutable base **digest**,
  passed to the Dockerfile via `NODE_BASE_IMAGE`. Normal local and
  CI Docker builds still use the existing default base tag.
- `npm ci` and the committed lockfile constrain JS dependencies.
  **Byte-for-byte reproducibility across distinct rebuilds is not
  guaranteed** (build timestamps, npm lifecycle behavior and image
  layer metadata may differ). Instead, this workflow ensures exact
  **identity and integrity of the archived images** built in one run.

The repository is currently public, which supports GitHub-hosted
public Sigstore-backed artifact attestations. If the repository becomes
private, check your GitHub plan's artifact attestation eligibility.

## Contents and verification

The build uses a source-commit-specific tag for both images:

```text
gym-api:runtime-<40-character-main-commit-sha>
gym-api:migrate-<40-character-main-commit-sha>
```

The two images are stored in `images.tar.gz` created from `docker save`;
the adjacent `manifest.json` records schema version, source repository,
commit, workflow/run ID, base digest, both image config IDs, archive
SHA-256 and byte count. Neither file contains actual production secrets.

The build job then creates **GitHub Actions SLSA provenance attestations**
for *both* files using `actions/attest@v4`, and uploads an immutable
GitHub Actions artifact named
`gym-api-release-<commit>-<run-id>` retained for **7 days**.

A separate job downloads the artifact, checks its manifest fields and
SHA-256, verifies both attestation signatures with `gh attestation verify`
constrained to **this repository, exact source commit, `main` and
the release-artifacts signer workflow**, then `docker load`s the
archive and confirms both config digests and
`org.opencontainers.image.revision` labels match the manifest.
Both images must run as non-root `node`.

A **green package job alone is insufficient**. Require the
`Re-download, verify provenance and reload images` job to succeed too.

## Manual verification and promotion

For an archived run, download the artifact through the Actions UI or:

```sh
gh run download RUN_ID --repo sauron9521/gym-api-nestjs \
  -n gym-api-release-COMMIT_SHA-RUN_ID -D release/
```

From the *same checked-out source commit*, check content:

```sh
node scripts/release-bundle.mjs verify \
  --archive release/images.tar.gz --manifest release/manifest.json \
  --commit COMMIT_SHA --repository sauron9521/gym-api-nestjs \
  --run-id RUN_ID
```

Verify **both signed attestations** against the expected workflow and
commit (not just a generic repository signature):

```sh
gh attestation verify release/images.tar.gz \
  --repo sauron9521/gym-api-nestjs \
  --signer-workflow sauron9521/gym-api-nestjs/.github/workflows/release-artifacts.yml \
  --source-ref refs/heads/main --source-digest COMMIT_SHA
gh attestation verify release/manifest.json \
  --repo sauron9521/gym-api-nestjs \
  --signer-workflow sauron9521/gym-api-nestjs/.github/workflows/release-artifacts.yml \
  --source-ref refs/heads/main --source-digest COMMIT_SHA
docker load -i release/images.tar.gz
node scripts/release-bundle.mjs verify-images \
  --manifest release/manifest.json --commit COMMIT_SHA \
  --repository sauron9521/gym-api-nestjs --run-id RUN_ID
```

**For production promotion:** store the verified archive in a controlled
artifact store or push the verified image to an authenticated registry.
Promote by immutable image digest after authorization and keep a record
of the verified source SHA, image IDs and deploy action. The 7-day
GitHub Actions retention period is not a long-term archive and does
not provide disaster recovery for databases/avatars.

The production Compose example remains `gym-api:local` with local builds;
it is **not** automatically retagged or updated by this workflow.
Never substitute an unverified `:latest` or mutable release tag.

## Limitations and operational safety

GitHub Attestations authenticate the signer identity and tie the file
hashes to a source repository/workflow; the JSON manifest alone is
**not a signature**. A signature does not establish that dependencies
lack vulnerabilities, that deployment was approved, or that a separate
rebuild has identical bytes. Maintain branch protection, keep the
required CI gate green, review release permissions, rotate base-image
digests when upgrading Node, run vulnerability audits and supervise
production deployment separately.

No production tokens, registry credentials or deployment secrets are
used. No remote image push, GitHub release publication or production
migration is performed. This workflow is intentionally manual to
separate code review from release authorization.


## Explicit GHCR promotion (PR #155)

The separate manual workflow `.github/workflows/publish-ghcr.yml` can
promote a completed and signed release archive to GHCR **without
rebuilding** either Docker image. It verifies the successful source run,
SHA-256 checksums, both GitHub attestations, non-root image IDs, and
existing remote tags before publishing. After upload it re-pulls both
images and reports **registry digest references** to use for deployment.
See [verified GHCR promotion](ghcr-promotion.md).

Do not promote until the release candidate workflow has finished with
both jobs green. **Pull by @sha256 digest**, not by a mutable GHCR tag.
No production deployment is performed by either workflow.
