import pg from 'pg';

import { useTestDatabase } from '../utility/test-db-helper.js';

const workoutIndex = 'workouts_athlete_id_created_at_id_idx';
const assignmentIndex =
  'training_program_assignments_athlete_id_assigned_at_id_idx';
const redundantIndex =
  'training_program_workouts_version_id_week_number_day_number_idx';
const uniqueIndex =
  'training_program_workouts_version_id_week_number_day_number_key';

type IndexRecord = {
  index_name: string;
  is_unique: boolean;
  is_valid: boolean;
  is_ready: boolean;
  definition: string;
};

describe('List-query index migration (PostgreSQL)', () => {
  let client: pg.Client;

  beforeAll(async () => {
    useTestDatabase();
    client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  it('builds valid and ready B-tree indexes for default athlete list ordering', async () => {
    const result = await client.query<IndexRecord>(`
      SELECT
        index_relation.relname AS index_name,
        index_info.indisunique AS is_unique,
        index_info.indisvalid AS is_valid,
        index_info.indisready AS is_ready,
        pg_get_indexdef(index_info.indexrelid) AS definition
      FROM pg_index AS index_info
      JOIN pg_class AS index_relation
        ON index_relation.oid = index_info.indexrelid
      JOIN pg_class AS table_relation
        ON table_relation.oid = index_info.indrelid
      JOIN pg_namespace AS namespace
        ON namespace.oid = table_relation.relnamespace
      WHERE namespace.nspname = current_schema()
        AND index_relation.relname = ANY($1::text[])
    `, [[workoutIndex, assignmentIndex, uniqueIndex, redundantIndex]]);

    const indexes = new Map(result.rows.map((row) => [row.index_name, row]));

    const workout = indexes.get(workoutIndex);
    expect(workout).toMatchObject({
      is_unique: false,
      is_valid: true,
      is_ready: true,
    });
    expect(workout?.definition).toContain(
      '(athlete_id, created_at DESC, id DESC)',
    );

    const assignment = indexes.get(assignmentIndex);
    expect(assignment).toMatchObject({
      is_unique: false,
      is_valid: true,
      is_ready: true,
    });
    expect(assignment?.definition).toContain(
      '(athlete_id, assigned_at DESC, id DESC)',
    );

    // Removing the duplicate index must never drop its unique counterpart.
    expect(indexes.has(redundantIndex)).toBe(false);
    expect(indexes.get(uniqueIndex)).toMatchObject({
      is_unique: true,
      is_valid: true,
      is_ready: true,
    });
    expect(indexes.get(uniqueIndex)?.definition).toContain(
      '(version_id, week_number, day_number)',
    );
  });
});
