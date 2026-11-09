import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '#prisma/client';
import { ExercisesService } from '#src/modules/exercises/services/exercises.service';
import { WorkoutsRepository } from '../repositories/workouts.repository.js';
import {
  assertWorkoutAthlete,
  validateWorkoutPagination,
} from '../policies/workout-access.policy.js';
import type {
  CreateWorkoutFromProgramInput,
  CreateWorkoutInput,
  UpdateWorkoutInput,
  UpdateWorkoutSetInput,
  WorkoutActor,
  WorkoutListQuery,
  WorkoutRecord,
} from '../types/workout.types.js';
import { TrainerAthletesService } from '#src/modules/trainer-athletes/services/trainer-athletes.service';
import { workoutIdempotency } from '../utils/workout-idempotency.js';
import type { WorkoutIdempotency } from '../utils/workout-idempotency.js';

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly workoutsRepository: WorkoutsRepository,
    private readonly exercisesService: ExercisesService,
    private readonly trainerAthletesService: TrainerAthletesService,
  ) {}

  // CREATE
  async create(
    actor: WorkoutActor,
    input: CreateWorkoutInput,
    idempotencyKey?: string,
  ) {
    assertWorkoutAthlete(actor);
    const idempotency = workoutIdempotency(
      idempotencyKey,
      'manual',
      input,
    );

    return this.createIdempotently(actor.id, idempotency, async () => {
    if (input.exercises.length === 0) {
      throw new BadRequestException(
        'A workout must contain at least one exercise',
      );
    }

    for (const exercise of input.exercises) {
      if (exercise.sets.length === 0) {
        throw new BadRequestException(
          'Each workout exercise must contain at least one set',
        );
      }
    }

    const exerciseIds = input.exercises.map((item) => item.exerciseId);

    const access =
      await this.trainerAthletesService.getExerciseAccessContext(actor);

    const availableExercises =
      await this.exercisesService.findAvailableForWorkout(
        actor,
        exerciseIds,
        access,
      );

    const exerciseMap = new Map(
      availableExercises.map((exercise) => [exercise.id, exercise]),
    );

    const data = {
      title: input.title.trim(),
      notes: input.notes ?? null,
      scheduledAt: input.scheduledAt ?? null,

      athlete: {
        connect: { id: actor.id },
      },

      createdBy: {
        connect: { id: actor.id },
      },

      exercises: {
        create: input.exercises.map((item, index) => {
          const exercise = exerciseMap.get(item.exerciseId);

          if (!exercise) {
            throw new BadRequestException(
              'One or more exercises are not available',
            );
          }

          return {
            exercise: {
              connect: { id: exercise.id },
            },

            exerciseNameSnapshot: exercise.name,
            exerciseTypeSnapshot: exercise.exerciseType,

            sortOrder: index,
            notes: item.notes ?? null,

            sets: {
              create: item.sets.map((set, setIndex) => ({
                setNumber: setIndex + 1,
                setType: set.setType ?? 'WORKING',

                plannedReps: set.plannedReps ?? null,
                plannedWeightKg: set.plannedWeightKg ?? null,
                plannedDurationSeconds: set.plannedDurationSeconds ?? null,
                plannedDistanceMeters: set.plannedDistanceMeters ?? null,

                restSeconds: set.restSeconds ?? null,
                targetRpe: set.targetRpe ?? null,
                targetRir: set.targetRir ?? null,
              })),
            },
          };
        }),
      },
    } satisfies Prisma.WorkoutCreateInput;

    return this.workoutsRepository.create(
      {
        ...data,
        ...(idempotency
          ? {
              idempotencyKey: idempotency.key,
              idempotencyFingerprint: idempotency.fingerprint,
            }
          : {}),
      },
      actor.id,
      exerciseIds,
    );
    });
  }

  // CREATE WORKOUT FROM PROGRAM
  async createFromProgram(
    actor: WorkoutActor,
    input: CreateWorkoutFromProgramInput,
    idempotencyKey?: string,
  ) {
    assertWorkoutAthlete(actor);
    const idempotency = workoutIdempotency(
      idempotencyKey,
      'from-program',
      input,
    );

    return this.createIdempotently(actor.id, idempotency, async () => {
    const workout = await this.workoutsRepository.createFromProgram({
      athleteId: actor.id,
      assignmentId: input.assignmentId,
      programWorkoutId: input.programWorkoutId,
      scheduledAt: input.scheduledAt,
      ...(idempotency ? { idempotency } : {}),
    });

    if (!workout) {
      throw new NotFoundException(
        'Active training program assignment or workout not found',
      );
    }

    return workout;
    });
  }

  // FIND MANY
  async findMany(actor: WorkoutActor, query: WorkoutListQuery) {
    assertWorkoutAthlete(actor);
    validateWorkoutPagination(query);

    if (
      query.scheduledFrom &&
      query.scheduledTo &&
      query.scheduledFrom > query.scheduledTo
    ) {
      throw new BadRequestException(
        'scheduledFrom must not be later than scheduledTo',
      );
    }

    const where: Prisma.WorkoutWhereInput = {
      athleteId: actor.id,

      ...(query.status ? { status: query.status } : {}),

      ...(query.scheduledFrom || query.scheduledTo
        ? {
            scheduledAt: {
              ...(query.scheduledFrom ? { gte: query.scheduledFrom } : {}),
              ...(query.scheduledTo ? { lte: query.scheduledTo } : {}),
            },
          }
        : {}),
    };

    const params = {
      where,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    };

    return query.view === 'summary'
      ? this.workoutsRepository.findManySummary(params)
      : this.workoutsRepository.findMany(params);
  }

  // FIND ONE
  async findOne(id: string, actor: WorkoutActor) {
    assertWorkoutAthlete(actor);

    const workout = await this.workoutsRepository.findById(id, {
      athleteId: actor.id,
    });

    if (!workout) {
      throw new NotFoundException('Workout not found');
    }

    return workout;
  }

  // UPDATE PLANNED WORKOUT
  async update(id: string, actor: WorkoutActor, input: UpdateWorkoutInput) {
    const workout = await this.findOne(id, actor);

    if (workout.status !== 'PLANNED') {
      throw new BadRequestException('Only planned workouts can be edited');
    }

    const data: Prisma.WorkoutUpdateInput = {};

    if (input.title !== undefined) {
      data.title = input.title.trim();
    }

    if (input.notes !== undefined) {
      data.notes = input.notes;
    }

    if (input.scheduledAt !== undefined) {
      data.scheduledAt = input.scheduledAt;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('At least one field must be provided');
    }

    return this.updateWithConflictHandling(
      {
        id,
        athleteId: actor.id,
        status: 'PLANNED',
      },
      data,
    );
  }

  // START WORKOUT

  async start(id: string, actor: WorkoutActor) {
    const workout = await this.findOne(id, actor);

    if (workout.status !== 'PLANNED') {
      throw new BadRequestException('Only planned workouts can be started');
    }

    try {
      const result = await this.workoutsRepository.startWorkout({
        id,
        athleteId: actor.id,
        startedAt: new Date(),
      });

      if (!result) {
        throw new ConflictException(
          'Workout or training program assignment state has changed. Reload and try again.',
        );
      }

      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ConflictException(
          'Workout state has changed. Reload and try again.',
        );
      }

      throw error;
    }
  }

  // UPDATE SET RESULT
  async updateSet(
    workoutId: string,
    setId: string,
    actor: WorkoutActor,
    input: UpdateWorkoutSetInput,
  ) {
    const workout = await this.findOne(workoutId, actor);

    if (workout.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        'Sets can only be updated during an active workout',
      );
    }

    const set = workout.exercises
      .flatMap((exercise) => exercise.sets)
      .find((item) => item.id === setId);

    if (!set) {
      throw new NotFoundException('Workout set not found');
    }

    const actualFields = [
      input.actualReps,
      input.actualWeightKg,
      input.actualDurationSeconds,
      input.actualDistanceMeters,
    ];

    if (
      input.status === 'SKIPPED' &&
      actualFields.some((value) => value !== undefined && value !== null)
    ) {
      throw new BadRequestException(
        'A skipped set cannot contain actual performance values',
      );
    }

    const data: Prisma.WorkoutSetUpdateInput = {
      status: input.status,
      completedAt: new Date(),
    };

    if (input.status === 'SKIPPED') {
      data.actualReps = null;
      data.actualWeightKg = null;
      data.actualDurationSeconds = null;
      data.actualDistanceMeters = null;
    } else {
      if (input.actualReps !== undefined) {
        data.actualReps = input.actualReps;
      }

      if (input.actualWeightKg !== undefined) {
        data.actualWeightKg = input.actualWeightKg;
      }

      if (input.actualDurationSeconds !== undefined) {
        data.actualDurationSeconds = input.actualDurationSeconds;
      }

      if (input.actualDistanceMeters !== undefined) {
        data.actualDistanceMeters = input.actualDistanceMeters;
      }
    }

    if (input.restSeconds !== undefined) {
      data.restSeconds = input.restSeconds;
    }

    if (input.rpe !== undefined) {
      data.rpe = input.rpe;
    }

    if (input.rir !== undefined) {
      data.rir = input.rir;
    }

    if (input.notes !== undefined) {
      data.notes = input.notes;
    }

    try {
      const updatedSet = await this.workoutsRepository.updateSet(setId, data);

      if (!updatedSet) {
        throw new ConflictException(
          'Workout is no longer in progress. Reload and try again.',
        );
      }

      return updatedSet;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ConflictException(
          'Workout set state has changed. Reload and try again.',
        );
      }

      throw error;
    }
  }

  // COMPLETE WORKOUT

  async complete(id: string, actor: WorkoutActor) {
    const workout = await this.findOne(id, actor);

    if (workout.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        'Only in-progress workouts can be completed',
      );
    }

    const sets = workout.exercises.flatMap((exercise) => exercise.sets);

    if (sets.length === 0 || sets.some((set) => set.status === 'PENDING')) {
      throw new BadRequestException(
        'All workout sets must be completed or skipped',
      );
    }

    if (!sets.some((set) => set.status === 'COMPLETED')) {
      throw new BadRequestException('At least one set must be completed');
    }

    try {
      // Atomic validation and completion under a row lock.
      const result = await this.workoutsRepository.completeWorkout({
        id,
        athleteId: actor.id,
        completedAt: new Date(),
      });

      switch (result.status) {
        case 'COMPLETED':
          return result.workout;

        case 'NOT_IN_PROGRESS':
          throw new ConflictException(
            'Workout state has changed. Reload and try again.',
          );

        case 'INVALID_SETS':
          throw new ConflictException(
            'Workout sets have changed. Reload and try again.',
          );
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ConflictException(
          'Workout state has changed. Reload and try again.',
        );
      }

      throw error;
    }
  }

  // CANCEL WORKOUT
  async cancel(id: string, actor: WorkoutActor) {
    const workout = await this.findOne(id, actor);

    if (workout.status !== 'PLANNED' && workout.status !== 'IN_PROGRESS') {
      throw new BadRequestException('This workout cannot be cancelled');
    }

    return this.updateWithConflictHandling(
      {
        id,
        athleteId: actor.id,
        status: workout.status,
      },
      {
        status: 'CANCELLED',
      },
    );
  }

  // HELPERS
  private async findIdempotentReplay(
    athleteId: string,
    idempotency: WorkoutIdempotency,
  ): Promise<WorkoutRecord | null> {
    const original = await this.workoutsRepository.findByIdempotencyKey(
      athleteId,
      idempotency.key,
    );

    if (!original) return null;

    if (original.idempotencyFingerprint !== idempotency.fingerprint) {
      throw new ConflictException(
        'Idempotency-Key was already used for a different workout request.',
      );
    }

    // Return the current representation of the original workout. Clients
    // can resume it even if its status changed since initial creation.
    return this.workoutsRepository.findById(original.id, { athleteId });
  }

  private async createIdempotently(
    athleteId: string,
    idempotency: WorkoutIdempotency | undefined,
    create: () => Promise<WorkoutRecord>,
  ): Promise<WorkoutRecord> {
    if (!idempotency) return create();

    const replay = await this.findIdempotentReplay(athleteId, idempotency);
    if (replay) return replay;

    try {
      return await create();
    } catch (error) {
      // A second concurrent request can win the UNIQUE race. After the
      // failed insert/transaction rolled back, fetch the committed winner.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.findIdempotentReplay(athleteId, idempotency);
        if (winner) return winner;
      }
      throw error;
    }
  }

  private async updateWithConflictHandling(
    where: Prisma.WorkoutWhereUniqueInput,
    data: Prisma.WorkoutUpdateInput,
  ) {
    try {
      return await this.workoutsRepository.update(where, data);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new ConflictException(
          'Workout state has changed. Reload and try again.',
        );
      }

      throw error;
    }
  }
}
