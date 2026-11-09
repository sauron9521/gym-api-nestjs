import { Injectable } from '@nestjs/common';
import { PrismaService } from '#src/infra/database/index';
import type { ExerciseType } from '#prisma/client';
import { trainingProgramVersionSelect } from '../selects/training-program-version.select.js';
import { trainingProgramExerciseOrderSelect } from '../selects/training-program-query.select.js';
import type { UpdateTrainingProgramExerciseInput } from '../types/training-program.types.js';

@Injectable()
export class TrainingProgramExerciseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createProgramExercise(
    programId: string,
    versionId: string,
    workoutId: string,
    data: {
      exerciseId: string;
      exerciseNameSnapshot: string;
      exerciseTypeSnapshot: ExerciseType;
      sortOrder: number;
      notes: string | null;
    },
  ) {
    return this.prisma.trainingProgramVersion.update({
      where: {
        id: versionId,
        programId,
        status: 'DRAFT',
      },
      data: {
        updatedAt: new Date(),
        workouts: {
          update: {
            where: { id: workoutId },
            data: {
              exercises: {
                create: {
                  exercise: {
                    connect: { id: data.exerciseId },
                  },
                  exerciseNameSnapshot: data.exerciseNameSnapshot,
                  exerciseTypeSnapshot: data.exerciseTypeSnapshot,
                  sortOrder: data.sortOrder,
                  notes: data.notes,
                },
              },
            },
          },
        },
      },
      select: trainingProgramVersionSelect,
    });
  }

  async updateProgramExercise(
    programId: string,
    versionId: string,
    workoutId: string,
    exerciseId: string,
    data: UpdateTrainingProgramExerciseInput,
  ) {
    return this.prisma.trainingProgramVersion.update({
      where: {
        id: versionId,
        programId,
        status: 'DRAFT',
      },
      data: {
        updatedAt: new Date(),
        workouts: {
          update: {
            where: { id: workoutId },
            data: {
              exercises: {
                update: {
                  where: { id: exerciseId },
                  data,
                },
              },
            },
          },
        },
      },
      select: trainingProgramVersionSelect,
    });
  }

  async deleteProgramExercise(
    programId: string,
    versionId: string,
    workoutId: string,
    exerciseId: string,
  ) {
    return this.prisma.trainingProgramVersion.update({
      where: {
        id: versionId,
        programId,
        status: 'DRAFT',
      },
      data: {
        updatedAt: new Date(),
        workouts: {
          update: {
            where: { id: workoutId },
            data: {
              exercises: {
                delete: { id: exerciseId },
              },
            },
          },
        },
      },
      select: trainingProgramVersionSelect,
    });
  }

  async reorderProgramExercises(
    programId: string,
    versionId: string,
    workoutId: string,
    exerciseIds: string[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the draft version through a conditional update.
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

      const exercises = await tx.trainingProgramExercise.findMany({
        where: { workoutId },
        select: trainingProgramExerciseOrderSelect,
      });

      if (
        exercises.length !== exerciseIds.length ||
        new Set(exerciseIds).size !== exerciseIds.length ||
        !exerciseIds.every((id) => exercises.some((item) => item.id === id))
      ) {
        throw new Error('INVALID_EXERCISE_ORDER');
      }

      const maxSortOrder = Math.max(
        -1,
        ...exercises.map((item) => item.sortOrder),
      );

      const offset = maxSortOrder + exercises.length + 1;

      // Move to temporary positions.
      for (const [index, id] of exerciseIds.entries()) {
        await tx.trainingProgramExercise.update({
          where: { id, workoutId },
          data: { sortOrder: offset + index },
        });
      }

      // Apply the final positions.
      for (const [index, id] of exerciseIds.entries()) {
        await tx.trainingProgramExercise.update({
          where: { id, workoutId },
          data: { sortOrder: index },
        });
      }

      return tx.trainingProgramVersion.findUnique({
        where: { id: versionId },
        select: trainingProgramVersionSelect,
      });
    });
  }
}
