import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import pg from 'pg';

const DEFAULT_ROWS = 2_000;
const MAX_ROWS = 20_000;

export function validateTestDatabaseUrl(value) {
  if (!value) {
    throw new Error('TEST_DATABASE_URL is required; no DATABASE_URL fallback is allowed');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('TEST_DATABASE_URL must use the PostgreSQL protocol');
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!databaseName.toLowerCase().endsWith('_test')) {
    throw new Error('Refusing to benchmark a database whose name does not end in _test');
  }
  return value;
}

export function parseRows(argumentsList) {
  if (argumentsList.length === 0) return DEFAULT_ROWS;
  if (argumentsList.length !== 1 || !/^--rows=\d+$/.test(argumentsList[0])) {
    throw new Error('Usage: npm run perf:queries -- --rows=2000');
  }
  const rows = Number(argumentsList[0].slice('--rows='.length));
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > MAX_ROWS) {
    throw new Error(`--rows must be an integer between 1 and ${MAX_ROWS}`);
  }
  return rows;
}

export function summarizeExplain(label, data) {
  const report = data?.[0];
  const plan = report?.Plan;
  if (!plan || typeof report['Execution Time'] !== 'number') {
    throw new Error(`Unexpected EXPLAIN JSON for ${label}`);
  }

  const nodeTypes = new Set();
  let sharedHits = 0;
  let sharedReads = 0;
  function visit(node) {
    nodeTypes.add(node['Node Type']);
    sharedHits += node['Shared Hit Blocks'] ?? 0;
    sharedReads += node['Shared Read Blocks'] ?? 0;
    for (const child of node.Plans ?? []) visit(child);
  }
  visit(plan);

  // Root-plan blocks already include children; do not sum all nodes.
  return {
    label,
    rows: plan['Actual Rows'] ?? 0,
    planningMs: report['Planning Time'],
    executionMs: report['Execution Time'],
    sharedHits: plan['Shared Hit Blocks'] ?? sharedHits,
    sharedReads: plan['Shared Read Blocks'] ?? sharedReads,
    nodeTypes: [...nodeTypes].sort(),
  };
}

export function formatResults(results, rows) {
  const fmt = (n) => Number(n).toFixed(2);
  return [
    `# Workout / assignment list query benchmark (${rows} rows per table)`,
    '',
    '| Query | Planning ms | Execution ms | Rows | Shared hit | Shared read | Plan nodes |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...results.map((item) =>
      `| ${item.label} | ${fmt(item.planningMs)} | ${fmt(item.executionMs)} | ${item.rows} | ${item.sharedHits} | ${item.sharedReads} | ${item.nodeTypes.join(', ')} |`),
    '',
    'Execution times are observations, not pass/fail budgets; compare plans at the same row count.',
    'Queries model SQL filters and sorting, not Prisma relation hydration or HTTP serialization.',
  ].join('\n');
}

const sampleQueries = [
  {
    name: 'workouts.summary.page',
    query: `
      SELECT id, title, status, scheduled_at, created_at
      FROM workouts
      WHERE athlete_id = $1
      ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 0`,
    args: ({ athleteId }) => [athleteId],
  },
  {
    name: 'workouts.filtered.page',
    query: `
      SELECT id, title, status, scheduled_at, created_at
      FROM workouts
      WHERE athlete_id = $1 AND status = 'PLANNED'
        AND scheduled_at BETWEEN NOW() - INTERVAL '365 days' AND NOW()
      ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 0`,
    args: ({ athleteId }) => [athleteId],
  },
  {
    name: 'workouts.count',
    query: 'SELECT COUNT(*) FROM workouts WHERE athlete_id = $1',
    args: ({ athleteId }) => [athleteId],
  },
  {
    name: 'assignments.athlete.summary.page',
    query: `
      SELECT a.id, a.status, a.assigned_at, v.title, ta.status AS relationship_status
      FROM training_program_assignments AS a
      JOIN training_program_versions AS v ON v.id = a.version_id
      JOIN trainer_athletes AS ta ON ta.id = a.trainer_athlete_id
      WHERE a.athlete_id = $1
      ORDER BY a.assigned_at DESC, a.id DESC LIMIT 20 OFFSET 0`,
    args: ({ athleteId }) => [athleteId],
  },
  {
    name: 'assignments.trainer.summary.page',
    query: `
      SELECT a.id, a.status, a.assigned_at, v.title, ta.status AS relationship_status
      FROM training_program_assignments AS a
      JOIN training_program_versions AS v ON v.id = a.version_id
      JOIN training_programs AS p ON p.id = v.program_id
      JOIN trainer_athletes AS ta ON ta.id = a.trainer_athlete_id
      WHERE p.trainer_id = $1
      ORDER BY a.assigned_at DESC, a.id DESC LIMIT 20 OFFSET 0`,
    args: ({ trainerId }) => [trainerId],
  },
  {
    name: 'assignments.athlete.count',
    query: 'SELECT COUNT(*) FROM training_program_assignments WHERE athlete_id = $1',
    args: ({ athleteId }) => [athleteId],
  },
  {
    name: 'assignments.trainer.count',
    query: `
      SELECT COUNT(*)
      FROM training_program_assignments AS a
      JOIN training_program_versions AS v ON v.id = a.version_id
      JOIN training_programs AS p ON p.id = v.program_id
      WHERE p.trainer_id = $1`,
    args: ({ trainerId }) => [trainerId],
  },
];

export async function runBenchmark(connectionString, rows) {
  const client = new pg.Client({ connectionString: validateTestDatabaseUrl(connectionString) });
  await client.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query("SET LOCAL statement_timeout = '20s'");

    const ids = {
      trainerId: randomUUID(),
      athleteId: randomUUID(),
      relationshipId: randomUUID(),
      programId: randomUUID(),
      versionId: randomUUID(),
    };
    const tag = randomUUID();
    await client.query(`
      INSERT INTO users (id, email, password_hash, role, created_at, updated_at)
      VALUES
        ($1, $2, 'benchmark-hash', 'TRAINER', NOW(), NOW()),
        ($3, $4, 'benchmark-hash', 'ATHLETE', NOW(), NOW())
    `, [ids.trainerId, `perf-trainer-${tag}@example.test`, ids.athleteId, `perf-athlete-${tag}@example.test`]);

    await client.query(`
      INSERT INTO trainer_athletes
        (id, trainer_id, athlete_id, initiated_by_id, status, created_at, updated_at)
      VALUES ($1, $2, $3, $2, 'ACTIVE', NOW(), NOW())
    `, [ids.relationshipId, ids.trainerId, ids.athleteId]);

    await client.query(`
      INSERT INTO training_programs (id, trainer_id, status, created_at, updated_at)
      VALUES ($1, $2, 'PUBLISHED', NOW(), NOW())
    `, [ids.programId, ids.trainerId]);

    await client.query(`
      INSERT INTO training_program_versions
        (id, program_id, version, title, status, published_at, created_at, updated_at)
      VALUES ($1, $2, 1, 'Benchmark version', 'PUBLISHED', NOW(), NOW(), NOW())
    `, [ids.versionId, ids.programId]);

    // Use COMPLETED assignments so the partial unique ACTIVE constraint is respected.
    await client.query(`
      INSERT INTO training_program_assignments
        (id, version_id, trainer_athlete_id, athlete_id, assigned_by_id,
         status, assigned_at, created_at, updated_at)
      SELECT gen_random_uuid()::text, $1, $2, $3, $4,
        'COMPLETED', NOW() - series.n * INTERVAL '1 minute', NOW(), NOW()
      FROM generate_series(1, $5::integer) AS series(n)
    `, [ids.versionId, ids.relationshipId, ids.athleteId, ids.trainerId, rows]);

    await client.query(`
      INSERT INTO workouts
        (id, title, athlete_id, created_by_id, status, scheduled_at, created_at, updated_at)
      SELECT gen_random_uuid()::text, 'Benchmark workout', $1, $1, 'PLANNED',
        NOW() - series.n * INTERVAL '1 minute',
        NOW() - series.n * INTERVAL '1 minute', NOW()
      FROM generate_series(1, $2::integer) AS series(n)
    `, [ids.athleteId, rows]);

    // Stats for the synthetic fixture; transaction is rolled back afterward.
    await client.query('ANALYZE workouts');
    await client.query('ANALYZE training_program_assignments');

    const results = [];
    for (const item of sampleQueries) {
      const response = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${item.query}`,
        item.args(ids),
      );
      results.push(summarizeExplain(item.name, response.rows[0]['QUERY PLAN']));
    }

    return formatResults(results, rows);
  } finally {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    } else {
      await client.end();
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const rows = parseRows(process.argv.slice(2));
    const result = await runBenchmark(process.env.TEST_DATABASE_URL, rows);
    process.stdout.write(`${result}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result}\n`);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
