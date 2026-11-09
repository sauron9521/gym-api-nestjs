import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/index.js';
import { trainingProgramVersionSelect } from '../selects/training-program-version.select.js';

import type {
  CreateTrainingProgramWorkoutInput,
  UpdateTrainingProgramWorkoutInput,
} from '../types/training-program.types.js';

@Injectable()
export class TrainingProgramWorkoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createWorkout(
    programId: string,
    versionId: string,
    input: CreateTrainingProgramWorkoutInput,
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
          create: input,
        },
      },
      select: trainingProgramVersionSelect,
    });
  }

  async updateWorkout(
    programId: string,
    versionId: string,
    workoutId: string,
    input: UpdateTrainingProgramWorkoutInput,
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
            data: input,
          },
        },
      },
      select: trainingProgramVersionSelect,
    });
  }

  async deleteWorkout(programId: string, versionId: string, workoutId: string) {
    return this.prisma.trainingProgramVersion.update({
      where: {
        id: versionId,
        programId,
        status: 'DRAFT',
      },
      data: {
        updatedAt: new Date(),
        workouts: {
          delete: { id: workoutId },
        },
      },
      select: trainingProgramVersionSelect,
    });
  }
}
