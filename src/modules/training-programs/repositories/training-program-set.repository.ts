import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/index.js';
import { trainingProgramVersionSelect } from '../selects/training-program-version.select.js';
import type { WorkoutSetType } from '../../../generated/prisma/client.js';
import type { UpdateTrainingProgramSetInput } from '../types/training-program.types.js';

@Injectable()
export class TrainingProgramSetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createProgramSet(
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    data: {
      setNumber: number;
      setType?: WorkoutSetType;
      plannedReps?: number | null;
      plannedWeightKg?: number | null;
      plannedDurationSeconds?: number | null;
      plannedDistanceMeters?: number | null;
      restSeconds?: number | null;
      targetRpe?: number | null;
      targetRir?: number | null;
      notes?: string | null;
    },
  ) {
    return this.prisma.trainingProgramVersion.update({
      where: {
        id: versionId,
        programId,
        status: 'DRAFT',
      },
      data: {
        workouts: {
          update: {
            where: { id: workoutId },
            data: {
              exercises: {
                update: {
                  where: { id: programExerciseId },
                  data: {
                    sets: {
                      create: {
                        ...data,
                        setType: data.setType ?? 'WORKING',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      select: trainingProgramVersionSelect,
    });
  }

  async updateProgramSet(
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    setId: string,
    data: UpdateTrainingProgramSetInput,
  ) {
    return this.prisma.trainingProgramVersion.update({
      where: {
        id: versionId,
        programId,
        status: 'DRAFT',
      },
      data: {
        workouts: {
          update: {
            where: { id: workoutId },
            data: {
              exercises: {
                update: {
                  where: { id: programExerciseId },
                  data: {
                    sets: {
                      update: {
                        where: { id: setId },
                        data,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      select: trainingProgramVersionSelect,
    });
  }

  async deleteProgramSet(
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    setId: string,
  ) {
    return this.prisma.trainingProgramVersion.update({
      where: {
        id: versionId,
        programId,
        status: 'DRAFT',
      },
      data: {
        workouts: {
          update: {
            where: { id: workoutId },
            data: {
              exercises: {
                update: {
                  where: { id: programExerciseId },
                  data: {
                    sets: {
                      delete: { id: setId },
                    },
                  },
                },
              },
            },
          },
        },
      },
      select: trainingProgramVersionSelect,
    });
  }
  async reorderProgramSets(
    programId: string,
    versionId: string,
    workoutId: string,
    programExerciseId: string,
    setIds: string[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.trainingProgramVersion.update({
        where: {
          id: versionId,
          programId,
          status: 'DRAFT',
        },
        data: {
          updatedAt: new Date(),
        },
      });

      const sets = await tx.trainingProgramSet.findMany({
        where: { programExerciseId },
        select: { id: true, setNumber: true },
      });

      if (
        sets.length !== setIds.length ||
        new Set(setIds).size !== setIds.length ||
        !setIds.every((id) => sets.some((set) => set.id === id))
      ) {
        throw new Error('INVALID_SET_ORDER');
      }

      const maxSetNumber = Math.max(0, ...sets.map((set) => set.setNumber));

      const offset = maxSetNumber + sets.length + 1;

      // Temporary positions
      for (const [index, id] of setIds.entries()) {
        await tx.trainingProgramSet.update({
          where: { id, programExerciseId },
          data: { setNumber: offset + index + 1 },
        });
      }

      // Final positions
      for (const [index, id] of setIds.entries()) {
        await tx.trainingProgramSet.update({
          where: { id, programExerciseId },
          data: { setNumber: index + 1 },
        });
      }

      return tx.trainingProgramVersion.findUnique({
        where: { id: versionId },
        select: trainingProgramVersionSelect,
      });
    });
  }
}
