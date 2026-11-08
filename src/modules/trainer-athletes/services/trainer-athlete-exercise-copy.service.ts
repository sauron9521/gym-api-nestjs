import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client.js';

/** Creates private athlete-owned copies using the caller's transaction. */
@Injectable()
export class TrainerAthleteExerciseCopyService {
  async copyRelevantExercises(
    tx: Prisma.TransactionClient,
    relationship: { trainerId: string; athleteId: string },
    activeFrom: Date,
    programExerciseIds: string[],
  ): Promise<void> {
    // 3. Find trainer exercises that were assigned to this athlete
    // or used in their started/completed workouts during this relationship.
    const sourceExercises = await tx.exercise.findMany({
      where: {
        source: 'TRAINER_CUSTOM',
        createdById: relationship.trainerId,
        OR: [
          {
            assignments: {
              some: {
                athleteId: relationship.athleteId,
                assignedById: relationship.trainerId,
                assignedAt: {
                  gte: activeFrom,
                },
              },
            },
          },
          {
            workoutExercises: {
              some: {
                workout: {
                  is: {
                    athleteId: relationship.athleteId,
                    createdAt: {
                      gte: activeFrom,
                    },
                    status: {
                      in: ['IN_PROGRESS', 'COMPLETED'],
                    },
                  },
                },
              },
            },
          },
          ...(programExerciseIds.length > 0
            ? [{ id: { in: programExerciseIds } }]
            : []),
        ],
      },
      select: {
        id: true,
        name: true,
        description: true,
        instructions: true,
        exerciseType: true,
        muscleGroups: {
          select: {
            muscleGroupId: true,
            role: true,
          },
        },
        equipment: {
          select: {
            equipmentId: true,
          },
        },
      },
    });

    // 4. Avoid duplicate personal copies if this trainer's
    // exercise was already copied to the athlete.
    const sourceExerciseIds = sourceExercises.map((exercise) => exercise.id);

    const existingCopies = sourceExerciseIds.length
      ? await tx.exercise.findMany({
          where: {
            createdById: relationship.athleteId,
            copiedFromExerciseId: {
              in: sourceExerciseIds,
            },
          },
          select: {
            copiedFromExerciseId: true,
          },
        })
      : [];

    const copiedSourceIds = new Set(
      existingCopies
        .map((exercise) => exercise.copiedFromExerciseId)
        .filter((id): id is string => id !== null),
    );

    // 5. Create private athlete-owned copies.
    // Keep these queries sequential inside the transaction.
    for (const exercise of sourceExercises) {
      if (copiedSourceIds.has(exercise.id)) {
        continue;
      }

      await tx.exercise.create({
        data: {
          name: exercise.name,
          description: exercise.description,
          instructions: exercise.instructions,
          exerciseType: exercise.exerciseType,

          source: 'ATHLETE_CUSTOM',
          visibility: 'PRIVATE',
          isArchived: false,

          createdById: relationship.athleteId,
          copiedFromExerciseId: exercise.id,

          muscleGroups: {
            create: exercise.muscleGroups.map((item) => ({
              role: item.role,
              muscleGroup: {
                connect: {
                  id: item.muscleGroupId,
                },
              },
            })),
          },

          equipment: {
            create: exercise.equipment.map((item) => ({
              equipment: {
                connect: {
                  id: item.equipmentId,
                },
              },
            })),
          },
        },
      });
    }
  }
}
