import { Injectable } from '@nestjs/common';

import { PrismaService } from '#src/infra/database/index';

export const exerciseTrainerAccessSelect = {
  id: true,
  exerciseId: true,
  trainerId: true,
  grantedAt: true,
  revokedAt: true,
} as const;

type ExerciseLockRow = {
  id: string;
  visibility: 'PRIVATE' | 'SELECTED_TRAINERS' | null;
};

export type GrantTrainerAccessResult =
  | { status: 'NOT_FOUND' }
  | { status: 'PRIVATE' }
  | { status: 'NO_ACTIVE_RELATIONSHIP' }
  | {
      status: 'GRANTED';
      grant: {
        id: string;
        exerciseId: string;
        trainerId: string;
        grantedAt: Date;
        revokedAt: Date | null;
      };
    };

@Injectable()
export class ExerciseTrainerAccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lock the active relationship before the exercise, matching termination.
   * The relationship lock serializes termination and grant creation; the
   * exercise lock serializes concurrent visibility changes and archiving.
   */
  async grant(
    exerciseId: string,
    athleteId: string,
    trainerId: string,
  ): Promise<GrantTrainerAccessResult> {
    return this.prisma.$transaction(async (tx) => {
      // Always lock the relationship first, matching termination's lock order.
      // Taking the exercise lock first can deadlock with termination, which
      // locks the relationship before revoking exercise grants.
      const relationships = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM trainer_athletes
        WHERE athlete_id = ${athleteId}
          AND trainer_id = ${trainerId}
          AND status = 'ACTIVE'
        FOR UPDATE
      `;

      if (!relationships.length) {
        return { status: 'NO_ACTIVE_RELATIONSHIP' };
      }

      const exercises = await tx.$queryRaw<ExerciseLockRow[]>`
        SELECT id, visibility::text AS visibility
        FROM exercises
        WHERE id = ${exerciseId}
          AND created_by_id = ${athleteId}
          AND source = 'ATHLETE_CUSTOM'
          AND is_archived = FALSE
        FOR UPDATE
      `;

      const exercise = exercises[0];
      if (!exercise) {
        return { status: 'NOT_FOUND' };
      }

      if (exercise.visibility !== 'SELECTED_TRAINERS') {
        return { status: 'PRIVATE' };
      }

      const grant = await tx.exerciseTrainerAccess.upsert({
        where: {
          exerciseId_trainerId: { exerciseId, trainerId },
        },
        create: { exerciseId, trainerId },
        update: { revokedAt: null, grantedAt: new Date() },
        select: exerciseTrainerAccessSelect,
      });

      return { status: 'GRANTED', grant };
    });
  }

  async list(exerciseId: string, athleteId: string) {
    const owned = await this.prisma.exercise.findFirst({
      where: {
        id: exerciseId,
        source: 'ATHLETE_CUSTOM',
        createdById: athleteId,
        isArchived: false,
      },
      select: { id: true },
    });

    if (!owned) {
      return null;
    }

    // Never show a stale grant from a terminated relationship.
    return this.prisma.exerciseTrainerAccess.findMany({
      where: {
        exerciseId,
        revokedAt: null,
        trainer: {
          trainerRelationships: {
            some: { athleteId, status: 'ACTIVE' },
          },
        },
      },
      select: exerciseTrainerAccessSelect,
      orderBy: [{ grantedAt: 'desc' }, { trainerId: 'asc' }],
    });
  }

  async revoke(exerciseId: string, athleteId: string, trainerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const exercises = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM exercises
        WHERE id = ${exerciseId}
          AND created_by_id = ${athleteId}
          AND source = 'ATHLETE_CUSTOM'
          AND is_archived = FALSE
        FOR UPDATE
      `;

      if (!exercises.length) {
        return false;
      }

      // Deleting an already revoked or absent grant is idempotent.
      await tx.exerciseTrainerAccess.updateMany({
        where: { exerciseId, trainerId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return true;
    });
  }
}
