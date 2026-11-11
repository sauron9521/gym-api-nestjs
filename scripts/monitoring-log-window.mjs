#!/usr/bin/env node
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute, basename, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// Fail closed if an unrotated source or malformed entry would make a
// supposedly complete five-minute count unreliable.
export const WINDOW_MS = 5 * 60 * 1000;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_LINE_BYTES = 64 * 1024;

export function parseLogFileArg(args) {
  if (args.length !== 2 || args[0] !== '--file' ||
      typeof args[1] !== 'string' || !isAbsolute(args[1]) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.jsonl$/.test(basename(args[1]))) {
    throw new Error('Invalid log source');
  }
  return args[1];
}

/** Accept only a bounded, timestamped JSON event from a trusted collector. */
export function selectWindowLine(line, nowMs) {
  if (typeof line !== 'string' || Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
    throw new Error('Invalid log entry');
  }
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    throw new Error('Invalid log entry');
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Invalid log entry');
  }
  const timestamp = record.timestamp ?? record.time;
  if (typeof timestamp !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) {
    throw new Error('Missing ISO timestamp');
  }
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at)) throw new Error('Invalid timestamp');
  // Ignore earlier events but reject future/clock-skewed entries, which
  // otherwise could keep the sample apparently healthy.
  if (at > nowMs + 5_000) throw new Error('Clock-skewed log entry');
  if (at < nowMs - WINDOW_MS || at > nowMs) return null;

  // Only emit whitelisted aggregate signals. The output must never carry
  // arbitrary log fields (authorization headers, session IDs or user data).
  const candidates = [record, record.message, record.context,
    record.metadata, record.data, record.message?.context,
    record.message?.metadata];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    if (candidate.event === 'http.request.completed') {
      const status = candidate.statusCode;
      return Number.isInteger(status) && status >= 100 && status <= 599
        ? JSON.stringify({ event: 'http.request.completed', statusCode: status })
        : null;
    }
    if (candidate.event === 'RATE_LIMIT_REDIS_UNAVAILABLE' ||
        candidate.event === 'RATE_LIMIT_REDIS_RECOVERED') {
      return JSON.stringify({ event: candidate.event });
    }
  }
  return null;
}

/** Read-only regular file; reject symlinks, pipes, writable-by-group/world
 * log sources and files that exceed the explicitly documented size cap.
 */
export async function filterLogFile(path, emit, nowMs = Date.now()) {
  const file = parseLogFileArg(['--file', path]);
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const handle = await open(file, flags);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES ||
        (stats.mode & 0o027) !== 0) {
      throw new Error('Untrusted log file');
    }
    const lines = createInterface({
      input: handle.createReadStream({ autoClose: false }),
      crlfDelay: Infinity,
    });
    try {
      for await (const line of lines) {
        const selected = selectWindowLine(line, nowMs);
        if (selected !== null) await emit(selected);
      }
    } finally {
      lines.close();
    }
  } finally {
    await handle.close();
  }
}

async function main() {
  try {
    const path = parseLogFileArg(process.argv.slice(2));
    await filterLogFile(path, (line) => {
      process.stdout.write(line + '\n');
    });
  } catch {
    // Source paths and raw log records can contain sensitive material.
    // Never echo the error or untrusted input to the journal.
    process.stderr.write('Monitoring log source unavailable or invalid\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
