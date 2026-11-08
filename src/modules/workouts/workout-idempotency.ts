import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export type WorkoutIdempotency = {
  key: string;
  fingerprint: string;
};

/**
 * The same key is reserved for the same canonical request, including its
 * operation (manual creation vs program-based creation).
 */
export function workoutIdempotency(
  key: string | undefined,
  operation: 'manual' | 'from-program',
  body: unknown,
): WorkoutIdempotency | undefined {
  if (key === undefined) return undefined;

  // An explicit blank or malformed header is not the same as no header.
  if (!/^[A-Za-z0-9._~-]{8,128}$/.test(key)) {
    throw new BadRequestException(
      'Idempotency-Key must contain 8–128 URL-safe ASCII characters.',
    );
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify(canonicalize({ operation, body })))
    .digest('hex');

  return { key, fingerprint };
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, nested]) => [name, canonicalize(nested)]),
    );
  }
  return value;
}
