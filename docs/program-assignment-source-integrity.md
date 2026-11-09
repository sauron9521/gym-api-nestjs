# PR #70 — Program assignment source integrity

## Finding

PR #68 prevents publishing a draft that references archived or unauthorized exercises. PR #67 prevents **creating a workout** from an archived source. However, `TrainingProgramAssignmentRepository.createAssignmentForActiveRelationship()` previously checked only an ACTIVE trainer–athlete relationship, a PUBLISHED version and a non-archived program. A source can be archived **after publication but before assignment**, resulting in a new ACTIVE assignment that cannot produce a workout.

## Transactional protection

The assignment repository now performs a source-availability gate in the same PostgreSQL interactive transaction as the assignment insert:

1. Read only the distinct referenced exercise IDs from the **exact PUBLISHED version belonging to the requested program**. Published versions are immutable through API draft mutators; the existing version row lock remains the authoritative final version status check.
2. If there are references, acquire ordered `SELECT ... FOR SHARE` locks on all corresponding exercise rows, before locking the trainer–athlete relationship. This conflicts with archival's `UPDATE is_archived`, just as in workout creation and start.
3. Require every exercise to exist, remain unarchived and have permitted provenance: global or owned by the assigning trainer (`TRAINER_CUSTOM`). Reject missing, archived, athlete-owned or foreign trainer-owned references.
4. Verify and lock the same ACTIVE trainer–athlete relationship (`FOR UPDATE`), PUBLISHED program version (`FOR SHARE`) and non-ARCHIVED program (`FOR SHARE`), then insert the assignment before transaction commit.

The lock order for assignments with exercise sources is **exercise rows → relationship → version → program**, avoiding a relationship/exercise lock inversion with PRs #64–67 workout creation and start paths. Assignment attempts that lose a race with archival return `null` at the repository boundary and the existing service maps this to its **409 Conflict** response. Neither a new assignment nor a partial workout is saved.

For compatibility, a legacy directly seeded published version without any exercise references follows the previous relationship/version/program checks (no exercise locks). New versions published through the API already require workouts, exercises and sets.

Archival after a successful assignment remains permissible: the assignment retains its historical program snapshot, while workout creation and planned start independently reject archived source exercises. This change ensures **availability at assignment time**, not perpetual exercise availability.

## Regression tests

- Unit checks verify the exact-version PUBLISHED preflight, rejection of an archived global exercise, an athlete custom exercise, a foreign trainer's exercise and a missing row; successful trainer-owned sources and duplicate IDs; ordered exercise → relationship → version → program lock acquisition before insertion.
- Real PostgreSQL tests use an actual published program with workout, exercise and set references. They cover successful assignment, archived source rejection with unchanged published snapshots and a deterministic concurrent archive-first race verified via `pg_blocking_pids()`. Existing integration suites still verify concurrent relationship termination and program archival.

## API & migration impact

No Prisma schema changes, migrations, new dependencies, DTOs, endpoints, success bodies or error-envelope changes. A newly attempted assignment whose published program refers to unavailable sources now returns the existing **409 Conflict** instead of creating an unusable ACTIVE assignment.
