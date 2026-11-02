import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/index.js';
import { Prisma } from '../../generated/prisma/client.js';

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
}