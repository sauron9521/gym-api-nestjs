#!/usr/bin/env node
// Promote verified release-candidate images; never build, deploy, or edit tags.
// Signing/attestation checks are enforced by the manual caller workflow.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from './release-bundle.mjs';

const SHA = /^[a-f0-9]{40}$/;
const RUN_ID = /^[1-9][0-9]{0,15}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MODES = new Set(['validate-run', 'targets', 'preflight', 'verify-published']);

export function parsePromotionOptions(args) {
  if (!MODES.has(args[0]) || (args.length - 1) % 2 !== 0) {
    throw new Error('Invalid promotion command');
  }
  const command = args[0];
  const values = {};
  for (let i = 1; i < args.length; i += 2) {
    const name = args[i];
    if (!['--repository', '--source-sha', '--release-run-id', '--run-json',
      '--manifest'].includes(name) || Object.hasOwn(values, name) ||
      !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Invalid promotion argument');
    }
    values[name.slice(2)] = args[i + 1];
  }
  const allowed = command === 'validate-run'
    ? ['repository', 'source-sha', 'release-run-id', 'run-json']
    : command === 'verify-published'
      ? ['repository', 'source-sha', 'release-run-id', 'manifest']
      : ['repository', 'source-sha', 'release-run-id'];
  if (Object.keys(values).length !== allowed.length ||
      !allowed.every((name) => Object.hasOwn(values, name)) ||
      !REPO.test(values.repository) || !SHA.test(values['source-sha']) ||
      !RUN_ID.test(values['release-run-id'])) {
    throw new Error('Invalid promotion identity');
  }
  return { command, ...values };
}

export function validateReleaseRun(run, opts) {
  const expectedPath = '.github/workflows/release-artifacts.yml';
  const runPath = run?.path;
  const workflowMatches = runPath === expectedPath ||
    runPath === opts.repository + '/' + expectedPath + '@refs/heads/main' ||
    runPath === opts.repository + '/' + expectedPath + '@main';
  if (String(run?.id) !== opts['release-run-id'] ||
      run.repository?.full_name !== opts.repository ||
      run.head_sha !== opts['source-sha'] || run.head_branch !== 'main' ||
      run.event !== 'workflow_dispatch' || run.status !== 'completed' ||
      run.conclusion !== 'success' || !workflowMatches) {
    throw new Error('Release run does not match the approved successful main workflow');
  }
  return true;
}

export function publicationTargets(repository, sha, releaseRunId) {
  if (!REPO.test(repository) || !SHA.test(sha) || !RUN_ID.test(releaseRunId)) {
    throw new Error('Invalid publishing identity');
  }
  const [owner, repo] = repository.toLowerCase().split('/');
  const tag = 'sha-' + sha + '-run-' + releaseRunId;
  return {
    runtime: 'ghcr.io/' + owner + '/' + repo + ':' + tag,
    migrate: 'ghcr.io/' + owner + '/' + repo + '-migrate:' + tag,
  };
}

function manifestIdentity(opts) {
  return {
    commit: opts['source-sha'], repository: opts.repository,
    'run-id': opts['release-run-id'],
  };
}

function imageRepo(imageRef) {
  const match = /^(ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+):sha-[a-f0-9]{40}-run-[0-9]+$/.exec(imageRef);
  if (!match) throw new Error('Invalid GHCR image reference');
  return match[1];
}

export async function targetAbsent(imageRef, actor, token, fetchFn = fetch) {
  const repo = imageRepo(imageRef).slice('ghcr.io/'.length);
  const tag = imageRef.slice(imageRef.lastIndexOf(':') + 1);
  if (typeof actor !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(actor) ||
      typeof token !== 'string' || !token) {
    throw new Error('Missing GHCR registry credentials');
  }
  // Obtain an authenticated pull-scoped bearer token. Do not log either token.
  const auth = 'Basic ' + Buffer.from(actor + ':' + token).toString('base64');
  const authUrl = new URL('https://ghcr.io/token');
  authUrl.searchParams.set('scope', 'repository:' + repo + ':pull');
  const response = await fetchFn(authUrl, {
    headers: { authorization: auth }, redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 200) throw new Error('GHCR token request failed');
  const data = await response.json();
  if (typeof data?.token !== 'string' || !data.token) {
    throw new Error('Missing scoped GHCR bearer token');
  }
  const url = new URL('https://ghcr.io/v2/' + repo + '/manifests/' + tag);
  const answer = await fetchFn(url, {
    method: 'HEAD',
    headers: {
      authorization: 'Bearer ' + data.token,
      accept: [
        'application/vnd.oci.image.index.v1+json',
        'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
        'application/vnd.docker.distribution.manifest.v2+json',
      ].join(', '),
    },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (answer.status === 404) return true;
  if (answer.status === 200) throw new Error('Refusing to overwrite an existing GHCR tag');
  throw new Error('GHCR tag existence check was inconclusive');
}

export async function preflight(opts, actor, token, fetchFn = fetch) {
  const tags = publicationTargets(
    opts.repository, opts['source-sha'], opts['release-run-id'],
  );
  for (const tag of Object.values(tags)) {
    await targetAbsent(tag, actor, token, fetchFn);
  }
  return tags;
}

export function verifyRemoteImage(tag, manifestImage, commit, inspect) {
  const repo = imageRepo(tag);
  if (inspect?.Id !== manifestImage?.id ||
      inspect?.Config?.User !== 'node' ||
      inspect?.Config?.Labels?.['org.opencontainers.image.revision'] !== commit) {
    throw new Error('Published image differs from the verified release archive');
  }
  const digests = inspect.RepoDigests ?? [];
  const matches = digests.filter((value) => typeof value === 'string' &&
    value.startsWith(repo + '@') && DIGEST.test(value.slice(repo.length + 1)));
  if (matches.length !== 1) {
    throw new Error('Cannot unambiguously identify the published registry digest');
  }
  return matches[0];
}

export function verifyPublishedImages(manifest, opts, inspect) {
  validateManifest(manifest, manifestIdentity(opts));
  const tags = publicationTargets(
    opts.repository, opts['source-sha'], opts['release-run-id'],
  );
  return Object.fromEntries(['runtime', 'migrate'].map((kind) => {
    const image = inspect(tags[kind]);
    return [kind, verifyRemoteImage(
      tags[kind], manifest.images[kind], opts['source-sha'], image,
    )];
  }));
}

async function main() {
  try {
    const opts = parsePromotionOptions(process.argv.slice(2));
    let result;
    if (opts.command === 'validate-run') {
      const run = JSON.parse(await readFile(opts['run-json'], 'utf8'));
      result = { releaseRunValid: validateReleaseRun(run, opts) };
    } else if (opts.command === 'targets') {
      result = publicationTargets(
        opts.repository, opts['source-sha'], opts['release-run-id'],
      );
    } else if (opts.command === 'preflight') {
      result = await preflight(opts, process.env.GITHUB_ACTOR, process.env.GH_TOKEN);
    } else {
      const manifest = JSON.parse(await readFile(opts.manifest, 'utf8'));
      result = verifyPublishedImages(manifest, opts, (tag) => {
        const raw = execFileSync('docker', ['image', 'inspect', tag, '--format', '{{json .}}'], {
          encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'],
        });
        return JSON.parse(raw);
      });
    }
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    // Never print token, OCI responses, untrusted JSON or local paths.
    process.stderr.write('GHCR promotion validation failed\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
