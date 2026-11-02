import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/index.js';
import { Prisma } from '../../generated/prisma/client.js';

export const trainerAthleteSelect = {
  id: true,
  trainerId: true,
  athleteId: true,
  initiatedById: true,
  status: true,

  respondedAt: true,
  endedAt: true,
  endedById: true,
  endReason: true,

  trainer: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  athlete: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  initiatedBy: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  endedBy: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrainerAthleteSelect;

export type FindManyTrainerAthletesParams = {
  where: Prisma.TrainerAthleteWhereInput;
  skip: number;
  take: number;
  orderBy?: Prisma.TrainerAthleteOrderByWithRelationInput[];
};

@Injectable()
export class TrainerAthletesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // FIND MANY
  async findMany({
    where,
    skip,
    take,
    orderBy = [{ createdAt: 'desc' }, { id: 'desc' }],
  }: FindManyTrainerAthletesParams) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.trainerAthlete.findMany({
        where,
        skip,
        take,
        orderBy,
        select: trainerAthleteSelect,
      }),

      this.prisma.trainerAthlete.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        skip,
        take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  // FIND BY ID
  async findById(id: string, where: Prisma.TrainerAthleteWhereInput = {}) {
    return this.prisma.trainerAthlete.findFirst({
      where: {
        AND: [{ id }, where],
      },
      select: trainerAthleteSelect,
    });
  }

  // FIND OPEN RELATIONSHIP
  async findOpenByPair(trainerId: string, athleteId: string) {
    return this.prisma.trainerAthlete.findFirst({
      where: {
        trainerId,
        athleteId,
        status: {
          in: ['PENDING', 'ACTIVE'],
        },
      },
      select: {
        id: true,
        status: true,
      },
    });
  }

  // CREATE
  async create(data: Prisma.TrainerAthleteCreateInput) {
    return this.prisma.trainerAthlete.create({
      data,
      select: trainerAthleteSelect,
    });
  }

  // UPDATE
  async update(
    where: Prisma.TrainerAthleteWhereUniqueInput,
    data: Prisma.TrainerAthleteUpdateInput,
  ) {
    return this.prisma.trainerAthlete.update({
      where,
      data,
      select: trainerAthleteSelect,
    });
  }

  // ACTIVE TRAINERS FOR ATHLETE
  async findActiveTrainerIdsForAthlete(athleteId: string): Promise<string[]> {
    const relationships = await this.prisma.trainerAthlete.findMany({
      where: {
        athleteId,
        status: 'ACTIVE',
      },
      select: {
        trainerId: true,
      },
    });

    return relationships.map((item) => item.trainerId);
  }

  // ACTIVE ATHLETES FOR TRAINER
  async findActiveAthleteIdsForTrainer(trainerId: string): Promise<string[]> {
    const relationships = await this.prisma.trainerAthlete.findMany({
      where: {
        trainerId,
        status: 'ACTIVE',
      },
      select: {
        athleteId: true,
      },
    });

    return relationships.map((item) => item.athleteId);
  }

  async terminateWithExerciseCopies(input: {
    id: string;
    actorId: string;
    reason?: string | null;
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
        select: trainerAthleteSelect,
      });
    });
  }
}
