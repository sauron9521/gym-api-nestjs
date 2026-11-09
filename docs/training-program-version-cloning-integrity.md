# PR #69 — Training program version cloning integrity

## Finding

`TrainingProgramVersionRepository.createDraftFromLatestPublished()` already uses a single Prisma transaction to copy a PUBLISHED version's workouts, exercises, sets and snapshots. PostgreSQL partial unique indexing on `(program_id) WHERE status = 'DRAFT'` prevents two committed drafts. However, two requests could both read "no draft" before inserting. In that race one request may receive a raw Prisma `P2002` error rather than the ordinary `null` "no eligible draft" result. An archive of the parent program could likewise commit after the eligibility read but before the clone transaction inserted the new version.

## Implementation

At the beginning of cloning, the repository now selects the non-archived parent `training_programs` row using `FOR UPDATE` in the **same interactive transaction** as the draft check, source read and nested clone insert.

1. A caller blocks on the program row while another clone or archive holds the lock.
2. After it acquires the lock, rechecks `status <> ARCHIVED`.
3. Checks whether a DRAFT exists; if so returns `null`, rather than racing a second insertion.
4. Reads the latest committed PUBLISHED version and constructs version `source.version + 1` with a fresh tree of nested workouts, exercises and sets, retaining all domain/snapshot values.
5. Inserts the entire copy atomically; the parent lock is held until commit.

The partial unique index and `(programId, version)` unique constraint remain as database defense-in-depth. No migration is needed. The service's existing handling of `null` as `409 Conflict` is unchanged; unexpected database errors remain errors.

Publication holds a DRAFT version row lock, then updates the program state, whereas cloning locks the program and **reads** PUBLISHED sources without locking their rows. Published sources are immutable through API draft mutators, so the copy is stable. An already active draft prevents a clone until it is published. The next clone observes the latest PUBLISHED version after the previous publication commits.

## Regression coverage

- Unit tests require the parent-row lock before checking draft or reading the published source, and ensure no source queries or writes follow a failed non-archived eligibility check.
- PostgreSQL concurrency test now requires **both concurrent clone calls to resolve normally**: exactly one creates the new DRAFT and the other returns `null`, not Prisma `P2002`.
- Deterministic archive-first race: hold the parent row with `FOR UPDATE`, begin cloning on another connection, observe real blocking with `pg_blocking_pids()`, mark parent ARCHIVED and commit, then verify cloning returns `null` and no DRAFT was created.
- Expanded real PostgreSQL copy-fidelity test: multiple workout weeks, multiple exercise positions, six sets with different set types, planned repetitions, decimal loads/distances, duration, rest, RPE/RIR and notes. All domain fields are compared between source and copy; new IDs and correct parent relationships are verified. Editing a copied set does not mutate the original published version.
- Existing integration tests cover next-version numbering after publication, absence of source, single draft indexing and concurrent publication.

## Compatibility

No Prisma schema/migration, DTOs, dependencies, HTTP success contracts, exercise snapshots or history changes. The intended change is that a losing concurrent clone request now deterministically returns `null` (service maps to `409 Conflict`), rather than sometimes propagating `P2002`. Cloning after parent archival is consistently denied.
