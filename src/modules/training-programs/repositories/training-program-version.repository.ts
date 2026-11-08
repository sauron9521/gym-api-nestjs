import { BadRequestException, Injectable } from '@nestjs/common';
import { assertPublishableVersion } from '../policies/training-program-publication.policy.js';
import { PrismaService } from '../../../database/index.js';
import { trainingProgramVersionSelect } from '../selects/training-program-version.select.js';
import { trainingProgramDraftAccessSelect } from '../selects/training-program-access.select.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { TrainingProgramVersionPayload } from '../types/training-program-payload.types.js';

@Injectable()
export class TrainingProgramVersionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findVersions(programId: string) {
    return this.prisma.trainingProgramVersion.findMany({
      where: { programId },
      orderBy: { version: 'desc' },
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

  async findVersionForEditing(
    id: string,
    where: Prisma.TrainingProgramVersionWhereInput = {},
  ) {
    return this.prisma.trainingProgramVersion.findFirst({
      where: { AND: [{ id }, where] },
      select: trainingProgramDraftAccessSelect,
    });
  }

  async findVersionById(
    id: string,
    where: Prisma.TrainingProgramVersionWhereInput = {},
  ): Promise<TrainingProgramVersionPayload | null> {
    return this.prisma.trainingProgramVersion.findFirst({
      where: {
        AND: [{ id }, where],
      },
      select: trainingProgramVersionSelect,
    });
  }

  async findVersionByNumber(
    programId: string,
    version: number,
  ): Promise<TrainingProgramVersionPayload | null> {
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

  async findDraftVersion(
    programId: string,
  ): Promise<TrainingProgramVersionPayload | null> {
    return this.prisma.trainingProgramVersion.findFirst({
      where: {
        programId,
        status: 'DRAFT',
      },
      select: trainingProgramVersionSelect,
    });
  }

  async createVersion(
    data: Prisma.TrainingProgramVersionCreateInput,
  ): Promise<TrainingProgramVersionPayload> {
    return this.prisma.trainingProgramVersion.create({
      data,
      select: trainingProgramVersionSelect,
    });
  }

  async updateVersion(
    where: Prisma.TrainingProgramVersionWhereUniqueInput,
    data: Prisma.TrainingProgramVersionUpdateInput,
  ): Promise<TrainingProgramVersionPayload> {
    // Only a numeric duration change needs the additional invariant check.
    // All other writes retain their existing conditional update semantics.
    if (typeof data.durationWeeks !== 'number' || typeof where.id !== 'string') {
      return this.prisma.trainingProgramVersion.update({
        where,
        data,
        select: trainingProgramVersionSelect,
      });
    }

    const versionId = where.id;
    const requestedWeeks = data.durationWeeks;

    return this.prisma.$transaction(async (tx) => {
      // Serialize duration changes with publication and all draft edits.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "training_program_versions"
        WHERE "id" = ${versionId}
        FOR UPDATE
      `;

      if (rows.length === 0) {
        // Preserve Prisma's normal not-found / conditional-update semantics.
        return tx.trainingProgramVersion.update({
          where,
          data,
          select: trainingProgramVersionSelect,
        });
      }

      const latestWorkout = await tx.trainingProgramWorkout.findFirst({
        where: { versionId },
        orderBy: { weekNumber: 'desc' },
        select: { weekNumber: true },
      });

      if (latestWorkout && latestWorkout.weekNumber > requestedWeeks) {
        throw new BadRequestException(
          'A workout week cannot exceed the program duration',
        );
      }

      return tx.trainingProgramVersion.update({
        where,
        data,
        select: trainingProgramVersionSelect,
      });
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
        // Every draft mutator writes to the version row, so this lock makes
        // the authoritative validation and publication atomic.
        const drafts = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "training_program_versions"
          WHERE "id" = ${versionId}
            AND "program_id" = ${programId}
            AND "status" = 'DRAFT'
          FOR UPDATE
        `;

        if (drafts.length !== 1) {
          return null;
        }

        // Re-read the complete version AFTER acquiring the lock.
        const currentVersion = await tx.trainingProgramVersion.findUnique({
          where: { id: versionId },
          select: trainingProgramVersionSelect,
        });

        if (!currentVersion || currentVersion.status !== 'DRAFT') {
          return null;
        }

        assertPublishableVersion(currentVersion);

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

}
