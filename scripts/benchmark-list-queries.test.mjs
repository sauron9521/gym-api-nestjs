import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatResults,
  parseRows,
  summarizeExplain,
  validateTestDatabaseUrl,
} from './benchmark-list-queries.mjs';

describe('safe query-benchmark configuration', () => {
  it('requires a dedicated PostgreSQL test database', () => {
    const good = 'postgresql://postgres:postgres@localhost:5432/gym_app_test?schema=public';
    assert.equal(validateTestDatabaseUrl(good), good);
    assert.throws(() => validateTestDatabaseUrl(undefined), /TEST_DATABASE_URL is required/);
    assert.throws(() => validateTestDatabaseUrl('postgresql://localhost/gym_app'), /_test/);
    assert.throws(() => validateTestDatabaseUrl('postgresql://localhost/gym_app_testing'), /_test/);
    assert.throws(() => validateTestDatabaseUrl('mysql://localhost/gym_app_test'), /PostgreSQL/);
    assert.throws(() => validateTestDatabaseUrl('no url'), /valid PostgreSQL URL/);
  });

  it('bounds and validates the number of fixture rows', () => {
    assert.equal(parseRows([]), 2000);
    assert.equal(parseRows(['--rows=100']), 100);
    for (const input of [
      ['--rows=0'],
      ['--rows=20001'],
      ['--rows=Infinity'],
      ['--rows=1;DROP TABLE users'],
      ['--rows=-1'],
      ['--rows=10', '--other'],
    ]) {
      assert.throws(() => parseRows(input));
    }
  });
});

describe('PostgreSQL EXPLAIN reporting', () => {
  it('parses execution timing, index nodes, and root-level buffers', () => {
    const output = summarizeExplain('workouts.summary.page', [{
      Plan: {
        'Node Type': 'Limit',
        'Actual Rows': 20,
        'Shared Hit Blocks': 5,
        'Shared Read Blocks': 2,
        Plans: [{
          'Node Type': 'Index Scan',
          'Shared Hit Blocks': 5,
          'Shared Read Blocks': 2,
        }],
      },
      'Planning Time': 0.25,
      'Execution Time': 2.5,
    }]);

    assert.deepEqual(output, {
      label: 'workouts.summary.page',
      rows: 20,
      planningMs: 0.25,
      executionMs: 2.5,
      sharedHits: 5,
      sharedReads: 2,
      nodeTypes: ['Index Scan', 'Limit'],
    });
    assert.match(formatResults([output], 2000), /Index Scan, Limit/);
  });

  it('rejects unexpected EXPLAIN payloads', () => {
    assert.throws(() => summarizeExplain('bad', []), /Unexpected EXPLAIN JSON/);
  });
});
