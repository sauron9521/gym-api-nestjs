import type { LogLevel } from '@nestjs/common';
import type { AppEnv } from './env.schema.js';

const logLevels: readonly LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
];

/** Minimum level is configured without changing logger implementations. */
export function getLogLevels(level: AppEnv['LOG_LEVEL']): LogLevel[] {
  return logLevels.slice(0, logLevels.indexOf(level) + 1);
}
