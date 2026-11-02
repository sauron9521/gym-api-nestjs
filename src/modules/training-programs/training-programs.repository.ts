import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/index.js';
import type { ExerciseType } from '../../generated/prisma/client.js';
import { Prisma } from '../../generated/prisma/client.js';
import type {
  CreateTrainingProgramWorkoutInput,
  UpdateTrainingProgramExerciseInput,
  UpdateTrainingProgramWorkoutInput,
} from './types/training-program.types.js';

// -----------------------------------------------------------------------------
// SELECTS
// -----------------------------------------------------------------------------

export const trainingProgramSelect = {
  id: true,
  trainerId: true,
  status: true,

  versions: {
    orderBy: {
      version: 'desc',
    },
    take: 1,
    select: {
      id: true,
      version: true,
      title: true,
      description: true,
      durationWeeks: true,
      status: true,
      publishedAt: true,
    },
  },

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrainingProgramSelect;

export const trainingProgramVersionSelect = {
  id: true,
  programId: true,
  version: true,

  title: true,
  description: true,
  durationWeeks: true,

  status: true,
  publishedAt: true,

  workouts: {
    orderBy: [{ weekNumber: 'asc' }, { dayNumber: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      versionId: true,

      weekNumber: true,
      dayNumber: true,

      title: true,
      notes: true,

      exercises: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          workoutId: true,
          exerciseId: true,

          exerciseNameSnapshot: true,
          exerciseTypeSnapshot: true,

          sortOrder: true,
          notes: true,

          sets: {
            orderBy: {
              setNumber: 'asc',
            },
            select: {
              id: true,
              programExerciseId: true,

              setNumber: true,
              setType: true,

              plannedReps: true,
              plannedWeightKg: true,
              plannedDurationSeconds: true,
              plannedDistanceMeters: true,

              restSeconds: true,
              targetRpe: true,
              targetRir: true,

              notes: true,
            },
          },

          createdAt: true,
          updatedAt: true,
        },
      },

      createdAt: true,
      updatedAt: true,
    },
  },

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrainingProgramVersionSelect;

export const trainingProgramAssignmentSelect = {
  id: true,

  versionId: true,
  trainerAthleteId: true,

  athleteId: true,
  assignedById: true,

  status: true,

  assignedAt: true,
  startedAt: true,
  completedAt: true,

  endedAt: true,
  endedById: true,
  endReason: true,

  version: {
    select: {
      id: true,
      programId: true,
      version: true,
      title: true,
      description: true,
      durationWeeks: true,
      status: true,
      publishedAt: true,

      program: {
        select: {
          id: true,
          trainerId: true,
          status: true,
        },
      },
    },
  },

  trainerAthlete: {
    select: {
      id: true,
      trainerId: true,
      athleteId: true,
      status: true,
    },
  },

  athlete: {
    select: {
      id: true,
      email: true,
      role: true,
    },
  },

  assignedBy: {
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

  workouts: {
    select: {
      id: true,
      title: true,
      status: true,
      scheduledAt: true,
      startedAt: true,
      completedAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  },

  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TrainingProgramAssignmentSelect;

// -----------------------------------------------------------------------------
// PARAMS
// -----------------------------------------------------------------------------

export type FindManyTrainingProgramsParams = {
  where: Prisma.TrainingProgramWhereInput;
  skip: number;
  take: number;
  orderBy?: Prisma.TrainingProgramOrderByWithRelationInput[];
};

export type FindManyTrainingProgramAssignmentsParams = {
  where: Prisma.TrainingProgramAssignmentWhereInput;
  skip: number;
  take: number;
  orderBy?: Prisma.TrainingProgramAssignmentOrderByWithRelationInput[];
};

// -----------------------------------------------------------------------------
// REPOSITORY
// -----------------------------------------------------------------------------

@Injectable()
export class TrainingProgramsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createProgramWithDraft(input: {
    trainerId: string;
    title: string;
    description?: string | null;
    durationWeeks?: number | null;
  }) {
    return this.prisma.trainingProgram.create({
      data: {
        trainer: {
          connect: { id: input.trainerId },
        },
        versions: {
          create: {
            version: 1,
            title: input.title,
            description: input.description ?? null,
            durationWeeks: input.durationWeeks ?? null,
            status: 'DRAFT',
          },
        },
      },
      select: trainingProgramSelect,
    });
  }

  async createDraftFromLatestPublished(programId: string) {
    return this.prisma.$transaction(async (tx) => {
      const program = await tx.trainingProgram.findFirst({
        where: {
          id: programId,
          status: { not: 'ARCHIVED' },
        },
        select: { id: true },
      });

      if (!program) {
        return null;
      }

      const existingDraft = await tx.trainingProgramVersion.findFirst({
        where: {
          programId,
          status: 'DRAFT',
        },
        select: { id: true },
      });

      if (existingDraft) {
        return null;
      }

      const source = await tx.trainingProgramVersion.findFirst({
        where: {
          programId,
          status: 'PUBLISHED',
        },
        orderBy: {
          version: 'desc',
        },
        select: trainingProgramVersionSelect,
      });

      if (!source) {
        return null;
      }

      return tx.trainingProgramVersion.create({
        data: {
          program: {
            connect: { id: programId },
          },

          version: source.version + 1,
          title: source.title,
          description: source.description,
          durationWeeks: source.durationWeeks,
          status: 'DRAFT',

          workouts: {
            create: source.workouts.map((workout) => ({
              weekNumber: workout.weekNumber,
              dayNumber: workout.dayNumber,
              title: workout.title,
              notes: workout.notes,

              exercises: {
                create: workout.exercises.map((exercise) => ({
                  exercise: {
                    connect: { id: exercise.exerciseId },
                  },

                  exerciseNameSnapshot: exercise.exerciseNameSnapshot,
                  exerciseTypeSnapshot: exercise.exerciseTypeSnapshot,

                  sortOrder: exercise.sortOrder,
                  notes: exercise.notes,

                  sets: {
                    create: exercise.sets.map((set) => ({
                      setNumber: set.setNumber,
                      setType: set.setType,

                      plannedReps: set.plannedReps,
                      plannedWeightKg: set.plannedWeightKg,
                      plannedDurationSeconds: set.plannedDurationSeconds,
                      plannedDistanceMeters: set.plannedDistanceMeters,

                      restSeconds: set.restSeconds,
                      targetRpe: set.targetRpe,
                      targetRir: set.targetRir,

                      notes: set.notes,
                    })),
                  },
                })),
              },
            })),
          },
        },
        select: trainingProgramVersionSelect,
      });
    });
  }

  async publishVersion(programId: string, versionId: string) {
    return this.prisma
      .$transaction(async (tx) => {
        const published = await tx.trainingProgramVersion.updateMany({
          where: {
            id: versionId,
            programId,
            status: 'DRAFT',
          },
          data: {
            status: 'PUBLISHED',
            publishedAt: new Date(),
          },
        });

        if (published.count !== 1) {
          return null;
        }

        const programUpdate = await tx.trainingProgram.updateMany({
          where: {
            id: programId,
            status: { not: 'ARCHIVED' },
          },
          data: {
            status: 'PUBLISHED',
          },
        });

        if (programUpdate.count !== 1) {
          throw new Error('PROGRAM_ARCHIVED');
        }

        return tx.trainingProgramVersion.findUnique({
          where: { id: versionId },
          select: trainingProgramVersionSelect,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === 'PROGRAM_ARCHIVED') {
          return null;
        }

        throw error;
      });
  }

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
        workouts: {
          delete: { id: workoutId },
        },
      },
      select: trainingProgramVersionSelect,
    });
  }

  // ===========================================================================
  // TRAINING PROGRAMS
  // ===========================================================================

  async findMany({
    where,
    skip,
    take,
    orderBy = [{ updatedAt: 'desc' }, { id: 'desc' }],
  }: FindManyTrainingProgramsParams) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.trainingProgram.findMany({
        where,
        skip,
        take,
        orderBy,
        select: trainingProgramSelect,
      }),

      this.prisma.trainingProgram.count({ where }),
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

  async findProgramById(
    id: string,
    where: Prisma.TrainingProgramWhereInput = {},
  ) {
    return this.prisma.trainingProgram.findFirst({
      where: {
        AND: [{ id }, where],
      },
      select: trainingProgramSelect,
    });
  }

  async createProgram(data: Prisma.TrainingProgramCreateInput) {
    return this.prisma.trainingProgram.create({
      data,
      select: trainingProgramSelect,
    });
  }

  async updateProgram(
    where: Prisma.TrainingProgramWhereUniqueInput,
    data: Prisma.TrainingProgramUpdateInput,
  ) {
    return this.prisma.trainingProgram.update({
      where,
      data,
      select: trainingProgramSelect,
    });
  }

  // ===========================================================================
  // PROGRAM VERSIONS
  // ===========================================================================

  async findVersions(programId: string) {
    return this.prisma.trainingProgramVersion.findMany({
      where: {
        programId,
      },
      orderBy: {
        version: 'desc',
      },
      select: {
        id: true,
        programId: true,
        version: true,
        title: true,
        description: true,
        durationWeeks: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findVersionById(
    id: string,
    where: Prisma.TrainingProgramVersionWhereInput = {},
  ) {
    return this.prisma.trainingProgramVersion.findFirst({
      where: {
        AND: [{ id }, where],
      },
      select: trainingProgramVersionSelect,
    });
  }

  async findVersionByNumber(programId: string, version: number) {
    return this.prisma.trainingProgramVersion.findUnique({
      where: {
        programId_version: {
          programId,
          version,
        },
      },
      select: trainingProgramVersionSelect,
    });
  }

  async findDraftVersion(programId: string) {
    return this.prisma.trainingProgramVersion.findFirst({
      where: {
        programId,
        status: 'DRAFT',
      },
      select: trainingProgramVersionSelect,
    });
  }

  async createVersion(data: Prisma.TrainingProgramVersionCreateInput) {
    return this.prisma.trainingProgramVersion.create({
      data,
      select: trainingProgramVersionSelect,
    });
  }

  async updateVersion(
    where: Prisma.TrainingProgramVersionWhereUniqueInput,
    data: Prisma.TrainingProgramVersionUpdateInput,
  ) {
    return this.prisma.trainingProgramVersion.update({
      where,
      data,
      select: trainingProgramVersionSelect,
    });
  }

  // ===========================================================================
  // PROGRAM ASSIGNMENTS
  // ===========================================================================

  async findManyAssignments({
    where,
    skip,
    take,
    orderBy = [{ assignedAt: 'desc' }, { id: 'desc' }],
  }: FindManyTrainingProgramAssignmentsParams) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.trainingProgramAssignment.findMany({
        where,
        skip,
        take,
        orderBy,
        select: trainingProgramAssignmentSelect,
      }),

      this.prisma.trainingProgramAssignment.count({ where }),
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

  async findAssignmentById(
    id: string,
    where: Prisma.TrainingProgramAssignmentWhereInput = {},
  ) {
    return this.prisma.trainingProgramAssignment.findFirst({
      where: {
        AND: [{ id }, where],
      },
      select: trainingProgramAssignmentSelect,
    });
  }

  async findActiveAssignmentByRelationship(trainerAthleteId: string) {
    return this.prisma.trainingProgramAssignment.findMany({
      where: {
        trainerAthleteId,
        status: 'ACTIVE',
      },
      select: trainingProgramAssignmentSelect,
    });
  }

  async createAssignment(data: Prisma.TrainingProgramAssignmentCreateInput) {
    return this.prisma.trainingProgramAssignment.create({
      data,
      select: trainingProgramAssignmentSelect,
    });
  }

  async updateAssignment(
    where: Prisma.TrainingProgramAssignmentWhereUniqueInput,
    data: Prisma.TrainingProgramAssignmentUpdateInput,
  ) {
    return this.prisma.trainingProgramAssignment.update({
      where,
      data,
      select: trainingProgramAssignmentSelect,
    });
  }

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
        select: { id: true, sortOrder: true },
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