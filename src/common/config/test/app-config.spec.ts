import { describe, expect, it } from 'vitest';

import { getCorsOrigins } from '../http.config.js';
import { getLogLevels } from '../logger.config.js';

describe('typed application config helpers', () => {
  it('normalizes the already validated comma-separated CORS origins', () => {
    expect(getCorsOrigins('https://a.example.test, https://b.example.test')).toEqual([
      'https://a.example.test',
      'https://b.example.test',
    ]);
  });

  it('keeps only the selected and more severe log levels', () => {
    expect(getLogLevels('error')).toEqual(['fatal', 'error']);
    expect(getLogLevels('warn')).toEqual(['fatal', 'error', 'warn']);
    expect(getLogLevels('log')).toEqual(['fatal', 'error', 'warn', 'log']);
    expect(getLogLevels('debug')).toEqual(['fatal', 'error', 'warn', 'log', 'debug']);
    expect(getLogLevels('verbose')).toHaveLength(6);
  });
});
