# PR #68 — Published training program exercise integrity

## Finding

Published program **structure** was already protected: draft mutations conditionally update the parent version with `status: DRAFT`, and `publishVersion()` locks the draft row before validating that each workout has exercises and each exercise has sets. Assignment creation also locks the published version, active trainer–athlete relationship and non-archived program.

One gap remained: **the references themselves were not validated against current exercise state at publication**. A trainer could add a valid global/trainer-owned exercise to a draft, have it archived before publication, and then publish a version that cannot be used to create a workout. A non-atomic read before publication would still allow an archive to commit after the read.

## Publication boundary

`TrainingProgramVersionRepository.publishVersion()` now, in one Prisma interactive transaction:

1. Acquires the existing `FOR UPDATE` lock on the **DRAFT version**. All draft workout/exercise/set mutations update the same parent version row, so their writes serialize with publication.
2. Reads the entire draft tree under the version lock, and validates non-empty workouts, exercise sets and program duration against workout weeks.
3. Extracts and deduplicates every referenced exercise ID.
4. Acquires ordered `SELECT ... FOR SHARE` locks on the corresponding exercise rows and checks that **all** rows exist and have `isArchived: false`.
5. Checks the exercise source is `GLOBAL` or `TRAINER_CUSTOM` created by the trainer who owns the program. Athlete-created exercises and custom exercises from other trainers are not eligible for publication, matching the draft editor's existing source policy.
6. Performs the existing conditional DRAFT → PUBLISHED update, non-archived program update and returns the published version, still inside the transaction.

Exercise archival is an UPDATE on the same row, conflicting with `FOR SHARE`. If an archive commits first, publication waits and rejects the archived source without changing the version or program. If publication takes the lock first, archive waits for publication to commit. The lock order is **version → exercise sources → program**, consistent with draft edit version locking; no new table, schema or index is introduced.

The published version remains immutable through the existing conditional draft-only mutations. Post-publication archival is allowed and does not rewrite version snapshots; PRs #66–67 already deny creating or starting workouts with sources that have subsequently become archived.

## Verification

- Repository unit tests validate query and lock ordering, active global/trainer sources, deduplicated references, archived sources, foreign trainer-owned sources, athlete-owned sources and missing references.
- Real PostgreSQL integration tests create full program/version/workout/exercise/set fixtures, assert rejection and unchanged status for pre-archived sources, reject athlete-owned references, verify published version draft mutators return Prisma P2025, and confirm successful assignment and creation of a planned workout preserves its exercise name snapshot.
- A deterministic concurrency test holds an exercise `FOR UPDATE` lock while publishing, observes blocking via `pg_blocking_pids()`, commits archival, and asserts publication fails while both program and version stay DRAFT.
- Existing assignment and workout creation CI coverage continues to protect the published-version and assignment boundaries.

## Compatibility

Publication of an invalid, archived or unauthorized exercise reference now returns **400 Bad Request**, using the existing standard API error envelope. The behavior change is intentional: such programs should not be published. No DTO, Prisma schema/migration, dependency or success-response change. Editing a valid *new draft* remains the supported way to revise a published version.
