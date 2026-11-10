import { BadRequestException, Injectable } from '@nestjs/common';

import { Prisma } from '#prisma/client';
import { PrismaService } from '#src/infra/database/index';
import { buildExerciseVisibilityWhere } from '#src/modules/exercises/policies/exercise-access.policy';
import { workoutExerciseReferenceSelect } from '#src/modules/exercises/selects/exercise.select';
import { workoutSelect } from '../selects/workout.select.js';
import { lockActiveTrainerRelationships, lockExerciseReferences } from './workout-locks.js';

/** Transactional workout creation, including program snapshots and access checks. */
@Injectable()
export class WorkoutCreationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // CREATE
  /**
   * Serialize manual workout creation with trainer-athlete termination.
   * Both operations use the same relationship row lock. Recheck access after
   * acquiring it, then insert before releasing the lock at commit.
   */
  async create(
    data: Prisma.WorkoutCreateInput,
    athleteId: string,
    exerciseIds: string[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const uniqueIds = [...new Set(exerciseIds)];

      // Lock exercise rows BEFORE relationship rows (the same order as
      // startWorkout). Archiving updates these rows and cannot commit between
      // this authorization check and the final workout insert.
      const lockedExercises = await lockExerciseReferences(tx, uniqueIds);
      if (
        lockedExercises.length !== uniqueIds.length ||
        lockedExercises.some((exercise) => exercise.isArchived)
      ) {
        throw new BadRequestException('One or more exercises are not available');
      }

      const trainerIds = [...new Set(
        lockedExercises
          .filter((exercise) => exercise.source === 'TRAINER_CUSTOM')
          .map((exercise) => exercise.createdById)
          .filter((id): id is string => id !== null),
      )];

      // Serialize with relationship termination using the same lock order as
      // planned workout starts: exercise -> relationship -> assignment.
      const activeRelationships = await lockActiveTrainerRelationships(
        tx,
        athleteId,
        trainerIds,
      );

      // Never trust the earlier service-side availability check: it may
      // have run before a concurrent termination. Validate inside this
      // transaction after the relationship locks have been acquired.
      const accessible = await tx.exercise.findMany({
        where: {
          AND: [
            { id: { in: uniqueIds } },
            buildExerciseVisibilityWhere(
              { id: athleteId, role: 'ATHLETE' },
              {
                activeTrainerIds: activeRelationships.map((r) => r.trainerId),
                activeAthleteIds: [],
              },
            ),
            { isArchived: false },
          ],
        },
        select: workoutExerciseReferenceSelect,
      });

      if (accessible.length !== uniqueIds.length) {
        throw new BadRequestException('One or more exercises are not available');
      }

      return tx.workout.create({ data, select: workoutSelect });
    });
  }

  async createFromProgram(input: {
    athleteId: string;
    assignmentId: string;
    programWorkoutId: string;
    scheduledAt?: Date | null;
    idempotency?: { key: string; fingerprint: string };
  }) {
    return this.prisma.$transaction(async (tx) => {
      // The published workout is immutable to ordinary clients, but load its
      // exercise references before taking locks so the lock order matches
      // manual creation and planned starts: exercises -> relationship -> assignment.
      const reference = await tx.trainingProgramAssignment.findFirst({
        where: {
          id: input.assignmentId,
          athleteId: input.athleteId,
          status: 'ACTIVE',
          version: { is: { status: 'PUBLISHED' } },
        },
        select: {
          version: {
            select: {
              workouts: {
                where: { id: input.programWorkoutId },
                select: { exercises: { select: { exerciseId: true } } },
              },
            },
          },
        },
      });

      const candidateWorkout = reference?.version.workouts[0];
      if (!candidateWorkout) return null;

      const referenceIds = [
        ...new Set(candidateWorkout.exercises.map((exercise) => exercise.exerciseId)),
      ];
      const lockedExercises = await lockExerciseReferences(tx, referenceIds);
      if (
        lockedExercises.length !== referenceIds.length ||
        lockedExercises.some((exercise) => exercise.isArchived)
      ) return null;

      // Check the current relationship AFTER securing the exercise rows,
      // before locking the assignment. Termination must wait at this boundary.
      const activeRelationships = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT relationship."id"
        FROM "trainer_athletes" AS relationship
        INNER JOIN "training_program_assignments" AS assignment
          ON assignment."trainer_athlete_id" = relationship."id"
        WHERE assignment."id" = ${input.assignmentId}
          AND assignment."athlete_id" = ${input.athleteId}
          AND relationship."status" = 'ACTIVE'
        FOR SHARE OF relationship
      `;
      if (activeRelationships.length !== 1) return null;

      // Serialize workout creation with assignment completion.
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
        return null;
      }
      const assignment = await tx.trainingProgramAssignment.findFirst({
        where: {
          id: input.assignmentId,
          athleteId: input.athleteId,
          status: 'ACTIVE',
          trainerAthlete: {
            is: {
              status: 'ACTIVE',
            },
          },
          version: {
            is: {
              status: 'PUBLISHED',
            },
          },
        },
        select: {
          id: true,
          version: {
            select: {
              workouts: {
                where: {
                  id: input.programWorkoutId,
                },
                select: {
                  id: true,
                  title: true,
                  notes: true,
                  exercises: {
                    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                    select: {
                      exerciseId: true,
                      exerciseNameSnapshot: true,
                      exerciseTypeSnapshot: true,
                      sortOrder: true,
                      notes: true,
                      sets: {
                        orderBy: { setNumber: 'asc' },
                        select: {
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
                    },
                  },
                },
              },
            },
          },
        },
      });

      const programWorkout = assignment?.version.workouts[0];

      if (!assignment || !programWorkout) {
        return null;
      }

      // Defensive consistency check: a concurrent change to the program
      // workout cannot introduce an exercise absent from our locked set.
      const currentIds = [
        ...new Set(programWorkout.exercises.map((exercise) => exercise.exerciseId)),
      ];
      if (
        currentIds.length !== referenceIds.length ||
        currentIds.some((id) => !referenceIds.includes(id))
      ) return null;

      return tx.workout.create({
        data: {
          title: programWorkout.title,
          notes: programWorkout.notes,
          scheduledAt: input.scheduledAt ?? null,
          ...(input.idempotency
            ? {
                idempotencyKey: input.idempotency.key,
                idempotencyFingerprint: input.idempotency.fingerprint,
              }
            : {}),

          athlete: {
            connect: { id: input.athleteId },
          },
          createdBy: {
            connect: { id: input.athleteId },
          },
          programAssignment: {
            connect: { id: assignment.id },
          },
          programWorkout: {
            connect: { id: programWorkout.id },
          },

          exercises: {
            create: programWorkout.exercises.map((exercise) => ({
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
        },
        select: workoutSelect,
      });
    });
  }


}
