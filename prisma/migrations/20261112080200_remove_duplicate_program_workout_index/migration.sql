-- The unique (version_id, week_number, day_number) index remains usable for
-- reads and enforces uniqueness. Remove only the redundant nonunique index.
DROP INDEX CONCURRENTLY "training_program_workouts_version_id_week_number_day_number_idx";
