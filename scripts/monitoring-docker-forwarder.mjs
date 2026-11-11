#!/usr/bin/env node
import { constants } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const MAX_DOCKER_LOG_LINE_BYTES = 64 * 1024;
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/;
const ALLOWED_EVENTS = new Set([
  'RATE_LIMIT_REDIS_UNAVAILABLE',
  'RATE_LIMIT_REDIS_RECOVERED',
]);

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function eventFromNestRecord(record) {
  const root = object(record);
  if (!root) return null;
  // Nest's ConsoleLogger({json:true}) uses message/context metadata.
  // Never preserve arbitrary fields from log messages or HTTP requests.
  const candidates = [
    root, root.message, root.context, root.metadata, root.data,
    object(root.message)?.context, object(root.message)?.metadata,
  ];
  for (const candidate of candidates) {
    const item = object(candidate);
    if (!item) continue;
    if (item.event === 'http.request.completed' &&
        Number.isInteger(item.statusCode) &&
        item.statusCode >= 100 && item.statusCode <= 599) {
      return { event: 'http.request.completed', statusCode: item.statusCode };
    }
    if (ALLOWED_EVENTS.has(item.event)) return { event: item.event };
  }
  return null;
}

/** Docker's --timestamps option prepends RFC3339Nano to each output line.
 * Sanitize event metadata BEFORE it can reach disk or stdout.
 */
export function normalizeDockerLogLine(line) {
  if (typeof line !== 'string' ||
      Buffer.byteLength(line, 'utf8') > MAX_DOCKER_LOG_LINE_BYTES) {
    throw new Error('Invalid Docker log line');
  }
  const space = line.indexOf(' ');
  if (space <= 0 || !TIMESTAMP.test(line.slice(0, space))) {
    throw new Error('Missing Docker timestamp');
  }
  const timestamp = Date.parse(line.slice(0, space));
  if (!Number.isFinite(timestamp)) throw new Error('Invalid Docker timestamp');

  const payload = line.slice(space + 1).trim();
  if (!payload.startsWith('{')) return null; // startup/text/debug logs
  let raw;
  try {
    raw = JSON.parse(payload);
  } catch {
    throw new Error('Malformed structured Docker log');
  }
  const safe = eventFromNestRecord(raw);
  if (!safe) return null;
  return JSON.stringify({ timestamp: new Date(timestamp).toISOString(), ...safe });
}

/** A second trust boundary prevents a compromised normalizer/CLI caller
 * from writing arbitrary log content into the group-readable snapshot.
 */
export function validateSnapshot(snapshot) {
  if (typeof snapshot !== 'string' ||
      Buffer.byteLength(snapshot, 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new Error('Invalid snapshot size');
  }
  if (snapshot === '') return;
  if (!snapshot.endsWith('\n')) throw new Error('Incomplete snapshot');
  for (const line of snapshot.slice(0, -1).split('\n')) {
    if (Buffer.byteLength(line, 'utf8') > MAX_DOCKER_LOG_LINE_BYTES) {
      throw new Error('Oversized snapshot event');
    }
    let record;
    try { record = JSON.parse(line); } catch { throw new Error('Malformed snapshot event'); }
    if (!object(record) || typeof record.timestamp !== 'string' ||
        !TIMESTAMP.test(record.timestamp) || !Number.isFinite(Date.parse(record.timestamp))) {
      throw new Error('Invalid snapshot timestamp');
    }
    const safe = eventFromNestRecord(record);
    if (!safe || JSON.stringify(record) !==
        JSON.stringify({ timestamp: record.timestamp, ...safe })) {
      throw new Error('Unexpected snapshot fields');
    }
  }
}

export function parsePublishArgs(args) {
  const path = args.length === 2 && args[0] === '--output' ? args[1] : null;
  if (typeof path !== 'string' || !isAbsolute(path) ||
      basename(path) !== 'events.jsonl') {
    throw new Error('Invalid snapshot destination');
  }
  return path;
}

/** Rotating fixed 10-minute window: replace the entire snapshot atomically
 * every minute, with no old raw Docker logs persisted or temp partial reads.
 */
export async function publishSnapshot(outputPath, content) {
  const path = parsePublishArgs(['--output', outputPath]);
  validateSnapshot(content);
  const directory = dirname(path);
  const dirInfo = await lstat(directory);
  if (!dirInfo.isDirectory() || (dirInfo.mode & 0o022) !== 0) {
    throw new Error('Untrusted snapshot directory');
  }
  try {
    const existing = await lstat(path);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error('Untrusted snapshot target');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const tempPath = join(directory, '.events.' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await open(tempPath, constants.O_WRONLY | constants.O_CREAT |
      constants.O_EXCL | constants.O_NOFOLLOW, 0o640);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, path);
  } catch {
    await handle?.close().catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
    throw new Error('Snapshot publication failed');
  }
}

async function readSnapshotInput() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === 'normalize' && args.length === 0) {
      let total = 0;
      for await (const line of createInterface({
        input: process.stdin, crlfDelay: Infinity,
      })) {
        const safe = normalizeDockerLogLine(line);
        if (safe !== null) {
          total += Buffer.byteLength(safe, 'utf8') + 1;
          if (total > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot too large');
          if (!process.stdout.write(safe + '\n')) {
            await new Promise((ok) => process.stdout.once('drain', ok));
          }
        }
      }
    } else if (mode === 'publish') {
      const output = parsePublishArgs(args);
      await publishSnapshot(output, await readSnapshotInput());
    } else {
      throw new Error('Unsupported forwarder operation');
    }
  } catch {
    // No paths, raw Docker log lines, passwords or token values in errors.
    process.stderr.write('Monitoring log forwarding failed\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
