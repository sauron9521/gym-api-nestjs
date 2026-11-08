import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../database/index.js';
import { TrainerAthleteExerciseCopyService } from './trainer-athlete-exercise-copy.service.js';
import {
  trainerAthleteHistoricalSelect,
  trainerAthleteSelect,
} from '../trainer-athletes.repository.js';

/**
 * Coordinates relationship termination, copies, assignment termination and
 * access revocation in one PostgreSQL transaction. Never commit between them.
 */
@Injectable()
export class TrainerAthleteTerminationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exerciseCopyService: TrainerAthleteExerciseCopyService,
  ) {}

  async terminateWithExerciseCopies(input: {
    id: string;
    actorId: string;
    reason?: string | null;
    redactForTrainer: boolean;
  }) {
    const endedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      // 1. Verify that the relationship is still active
      // and that the actor is one of its participants.
      const relationship = await tx.trainerAthlete.findFirst({
        where: {
          id: input.id,
          status: 'ACTIVE',
          OR: [{ trainerId: input.actorId }, { athleteId: input.actorId }],
        },
        select: {
          id: true,
          trainerId: true,
          athleteId: true,
          createdAt: true,
          respondedAt: true,
        },
      });

      if (!relationship) {
        return null;
      }

      // 2. Claim the transition. Only one concurrent request can win.
      const transition = await tx.trainerAthlete.updateMany({
        where: {
          id: input.id,
          status: 'ACTIVE',
          OR: [{ trainerId: input.actorId }, { athleteId: input.actorId }],
        },
        data: {
          status: 'TERMINATED',
          endedAt,
          endedById: input.actorId,
          endReason: input.reason ?? null,
        },
      });

      if (transition.count !== 1) {
        return null;
      }

      // 3. Collect exercises from active training program assignments.
      const activeProgramAssignments =
        await tx.trainingProgramAssignment.findMany({
          where: {
            trainerAthleteId: relationship.id,
            status: 'ACTIVE',
          },
          select: {
            version: {
              select: {
                workouts: {
                  select: {
                    exercises: {
                      select: {
                        exerciseId: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

      const programExerciseIds = [
        ...new Set(
          activeProgramAssignments.flatMap(({ version }) =>
            version.workouts.flatMap((workout) =>
              workout.exercises.map(({ exerciseId }) => exerciseId),
            ),
          ),
        ),
      ];

      // 3. Terminate all active program assignments
      // associated with this trainer-athlete relationship.
      await tx.trainingProgramAssignment.updateMany({
        where: {
          trainerAthleteId: relationship.id,
          status: 'ACTIVE',
        },
        data: {
          status: 'TERMINATED',
          endedAt,
          endedById: input.actorId,
          endReason: input.reason ?? null,
        },
      });

      const activeFrom = relationship.respondedAt ?? relationship.createdAt;

      // Keep exercise copying in the SAME transaction as revocations.
      await this.exerciseCopyService.copyRelevantExercises(
        tx,
        relationship,
        activeFrom,
        programExerciseIds,
      );

      // 6. Revoke trainer-to-athlete exercise assignments.
      await tx.exerciseAthleteAssignment.updateMany({
        where: {
          athleteId: relationship.athleteId,
          assignedById: relationship.trainerId,
          revokedAt: null,
        },
        data: {
          revokedAt: endedAt,
        },
      });

      // 7. Revoke trainer access to athlete-owned selected exercises.
      await tx.exerciseTrainerAccess.updateMany({
        where: {
          trainerId: relationship.trainerId,
          revokedAt: null,
          exercise: {
            is: {
              createdById: relationship.athleteId,
              source: 'ATHLETE_CUSTOM',
            },
          },
        },
        data: {
          revokedAt: endedAt,
        },
      });

      // 8. Return the terminated relationship.
      return tx.trainerAthlete.findUnique({
        where: {
          id: relationship.id,
        },
        select: input.redactForTrainer
          ? trainerAthleteHistoricalSelect
          : trainerAthleteSelect,
      });
    });
  }
}
