import { envSchema } from './env.schema.js';

/** Return normalized values without ever printing credentials or raw input. */
export function validateEnv(input: Record<string, unknown>) {
  const result = envSchema.safeParse(input);
  if (result.success) return result.data;

  const errors = result.error.issues
    .map((issue) => issue.path.join('.') + ': ' + issue.message)
    .join('; ');
  throw new Error('Invalid environment configuration: ' + errors);
}
