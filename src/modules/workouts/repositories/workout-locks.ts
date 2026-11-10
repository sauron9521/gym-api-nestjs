import { Prisma } from '#prisma/client';

/** Shared transaction-scoped locks: exercises -> relationships -> assignment. */
/**
 * Lock all referenced source exercise rows, not just trainer-owned ones.
 * FOR SHARE conflicts with the UPDATE used by ExercisesRepository.archive().
 * The transaction retains these locks until it commits the nested workout.
 */
export async function lockExerciseReferences(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<
  Array<{
    id: string;
    source: string;
    createdById: string | null;
    isArchived: boolean;
  }>
> {
  if (ids.length === 0) return [];

  return tx.$queryRaw<
    Array<{
      id: string;
      source: string;
      createdById: string | null;
      isArchived: boolean;
    }>
  >`
    SELECT
      "id",
      "source",
      "created_by_id" AS "createdById",
      "is_archived" AS "isArchived"
    FROM "exercises"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR SHARE
  `;
}

/** Obtain and retain current ACTIVE collaboration locks until transaction commit. */
export async function lockActiveTrainerRelationships(
  tx: Prisma.TransactionClient,
  athleteId: string,
  trainerIds: string[],
): Promise<Array<{ id: string; trainerId: string }>> {
  const ids = [...new Set(trainerIds)];
  if (ids.length === 0) return [];

  // Ordered row locks prevent lock-order inversions when multiple trainers
  // contribute exercises to the same workout.
  return tx.$queryRaw<Array<{ id: string; trainerId: string }>>`
    SELECT "id", "trainer_id" AS "trainerId"
    FROM "trainer_athletes"
    WHERE "athlete_id" = ${athleteId}
      AND "trainer_id" IN (${Prisma.join(ids)})
      AND "status" = 'ACTIVE'
    ORDER BY "id"
    FOR SHARE
  `;
}


