import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/index.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  trainingProgramAssignmentSelect,
  trainingProgramAssignmentDetailsSelect,
  trainingProgramAssignmentHistoricalSelect,
  trainingProgramAssignmentSummarySelect,
} from '../selects/training-program-assignment.select.js';
import type {
  TrainingProgramAssignmentPayload,
  TrainingProgramAssignmentDetailsPayload,
  TrainingProgramAssignmentSummaryPayload,
} from '../types/training-program-payload.types.js';
import type { PaginatedResult } from '../types/paginated-result.types.js';

export type FindManyTrainingProgramAssignmentsParams = {
  where: Prisma.TrainingProgramAssignmentWhereInput;
  skip: number;
  take: number;
  orderBy?: Prisma.TrainingProgramAssignmentOrderByWithRelationInput[];
  view?: 'full' | 'summary';
};

@Injectable()
export class TrainingProgramAssignmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyAssignments({
    where,
    skip,
    take,
    orderBy = [{ assignedAt: 'desc' }, { id: 'desc' }],
    view = 'full',
  }: FindManyTrainingProgramAssignmentsParams): Promise<
    PaginatedResult<
      TrainingProgramAssignmentPayload | TrainingProgramAssignmentSummaryPayload
    >
  > {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.trainingProgramAssignment.findMany({
        where,
        skip,
        take,
        orderBy,
        select:
          view === 'summary'
            ? trainingProgramAssignmentSummarySelect
            : trainingProgramAssignmentSelect,
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

  async findManyAssignmentsForTrainer({
    where,
    skip,
    take,
    orderBy = [{ assignedAt: 'desc' }, { id: 'desc' }],
    view = 'full',
  }: FindManyTrainingProgramAssignmentsParams) {
    // 1. Load a paginated list without sensitive fields.
    const [historicalAssignments, total] = await this.prisma.$transaction([
      this.prisma.trainingProgramAssignment.findMany({
        where,
        skip,
        take,
        orderBy,
        select: trainingProgramAssignmentHistoricalSelect,
      }),

      this.prisma.trainingProgramAssignment.count({
        where,
      }),
    ]);

    // 2. Find assignments whose relationship is still active.
    const activeIds = historicalAssignments
      .filter((assignment) => assignment.trainerAthlete.status === 'ACTIVE')
      .map((assignment) => assignment.id);

    // 3. Load full details in a single additional query.
    // Recheck the relationship state in the database.
    const activeAssignments =
      activeIds.length > 0
        ? await this.prisma.trainingProgramAssignment.findMany({
            where: {
              AND: [
                where,
                {
                  id: { in: activeIds },
                  trainerAthlete: {
                    is: {
                      status: 'ACTIVE',
                    },
                  },
                },
              ],
            },
            select:
              view === 'summary'
                ? trainingProgramAssignmentSummarySelect
                : trainingProgramAssignmentSelect,
          })
        : [];

    const activeById = new Map(
      activeAssignments.map((assignment) => [assignment.id, assignment]),
    );

    // 4. Preserve the original page order.
    const data = historicalAssignments.map(
      (assignment) => activeById.get(assignment.id) ?? assignment,
    );

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
  ): Promise<TrainingProgramAssignmentPayload | null> {
    return this.prisma.trainingProgramAssignment.findFirst({
      where: {
        AND: [{ id }, where],
      },
      select: trainingProgramAssignmentSelect,
    });
  }

  async findAssignmentDetailsById(
    id: string,
    where: Prisma.TrainingProgramAssignmentWhereInput = {},
  ): Promise<TrainingProgramAssignmentDetailsPayload | null> {
    return this.prisma.trainingProgramAssignment.findFirst({
      where: {
        AND: [{ id }, where],
      },
      select: trainingProgramAssignmentDetailsSelect,
    });
  }

  async findHistoricalAssignmentDetailsById(
    id: string,
    where: Prisma.TrainingProgramAssignmentWhereInput,
  ) {
    return this.prisma.trainingProgramAssignment.findFirst({
      where: {
        AND: [
          { id },
          where,
          {
            trainerAthlete: {
              is: {
                status: { not: 'ACTIVE' },
              },
            },
          },
        ],
      },
      select: trainingProgramAssignmentHistoricalSelect,
    });
  }

  async findActiveAssignmentByRelationship(
    trainerAthleteId: string,
  ): Promise<TrainingProgramAssignmentPayload[]> {
    return this.prisma.trainingProgramAssignment.findMany({
      where: {
        trainerAthleteId,
        status: 'ACTIVE',
      },
      select: trainingProgramAssignmentSelect,
    });
  }

  async updateAssignment(
    where: Prisma.TrainingProgramAssignmentWhereUniqueInput,
    data: Prisma.TrainingProgramAssignmentUpdateInput,
  ): Promise<TrainingProgramAssignmentPayload> {
    return this.prisma.trainingProgramAssignment.update({
      where,
      data,
      select: trainingProgramAssignmentSelect,
    });
  }

  async createAssignmentForActiveRelationship(input: {
    programId: string;
    versionId: string;
    trainerAthleteId: string;
    trainerId: string;
    athleteId: string;
  }): Promise<TrainingProgramAssignmentPayload | null> {
    return this.prisma.$transaction(async (tx) => {
      // Lock order is intentional: relationship -> version -> program.
      // Relationship termination serializes with the first lock;
      // publication takes the version lock before changing the program;
      // archival updates the program row.
      const relationships = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "trainer_athletes"
        WHERE "id" = ${input.trainerAthleteId}
          AND "trainer_id" = ${input.trainerId}
          AND "athlete_id" = ${input.athleteId}
          AND "status" = 'ACTIVE'
        FOR UPDATE
      `;

      if (relationships.length !== 1) {
        return null;
      }

      // Recheck the version while holding a row lock. The PUBLISHED
      // version must belong to the exact program being assigned.
      const versions = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "training_program_versions"
        WHERE "id" = ${input.versionId}
          AND "program_id" = ${input.programId}
          AND "status" = 'PUBLISHED'
        FOR SHARE
      `;

      if (versions.length !== 1) {
        return null;
      }

      // An archive transaction cannot commit between this check
      // and insertion of the assignment.
      const programs = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "training_programs"
        WHERE "id" = ${input.programId}
          AND "trainer_id" = ${input.trainerId}
          AND "status" <> 'ARCHIVED'
        FOR SHARE
      `;

      if (programs.length !== 1) {
        return null;
      }

      // Build the references from checked identifiers; callers cannot
      // validate one version and insert an assignment for another.
      return tx.trainingProgramAssignment.create({
        data: {
          version: { connect: { id: input.versionId } },
          trainerAthlete: { connect: { id: input.trainerAthleteId } },
          athlete: { connect: { id: input.athleteId } },
          assignedBy: { connect: { id: input.trainerId } },
        },
        select: trainingProgramAssignmentSelect,
      });
    });
  }

  async completeAssignmentIfNoUnfinishedWorkouts(input: {
    assignmentId: string;
    athleteId: string;
    completedAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const assignments = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "training_program_assignments"
      WHERE
        "id" = ${input.assignmentId}
        AND "athlete_id" = ${input.athleteId}
        AND "status" = 'ACTIVE'
      FOR UPDATE
    `;

      if (assignments.length !== 1) {
        return { status: 'NOT_ACTIVE' as const };
      }

      const unfinishedCount = await tx.workout.count({
        where: {
          programAssignmentId: input.assignmentId,
          status: {
            in: ['PLANNED', 'IN_PROGRESS'],
          },
        },
      });

      if (unfinishedCount > 0) {
        return {
          status: 'HAS_UNFINISHED_WORKOUTS' as const,
          unfinishedCount,
        };
      }

      const assignment = await tx.trainingProgramAssignment.update({
        where: {
          id: input.assignmentId,
          status: 'ACTIVE',
        },
        data: {
          status: 'COMPLETED',
          completedAt: input.completedAt,
        },
        select: trainingProgramAssignmentSelect,
      });

      return {
        status: 'COMPLETED' as const,
        assignment,
      };
    });
  }
}
