import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '#prisma/client';

import { ExercisesService } from '#src/modules/exercises/exercises.service';
import { WorkoutsRepository } from '../workouts.repository.js';
import { WorkoutsService } from '../workouts.service.js';

import type {
  CreateWorkoutFromProgramInput,
  CreateWorkoutInput,
  WorkoutActor,
} from '../types/workout.types.js';
import { TrainerAthletesService } from '#src/modules/trainer-athletes/services/trainer-athletes.service';

describe('WorkoutsService', () => {
  let service: WorkoutsService;

  const repository = {
    create: vi.fn(),
    createFromProgram: vi.fn(),
    findMany: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    updateSet: vi.fn(),
    completeWorkout: vi.fn(),
    startWorkout: vi.fn(),
  };

  const exercisesService = {
    findAvailableForWorkout: vi.fn(),
  };

  const athlete: WorkoutActor = {
    id: 'athlete-1',
    role: 'ATHLETE',
  };

  const trainer: WorkoutActor = {
    id: 'trainer-1',
    role: 'TRAINER',
  };

  const availableExercise = {
    id: 'exercise-1',
    name: 'Bench Press',
    exerciseType: 'STRENGTH',
  };

  const createInput: CreateWorkoutInput = {
    title: 'Upper Body',
    notes: 'Push workout',
    exercises: [
      {
        exerciseId: 'exercise-1',
        sets: [
          {
            plannedReps: 10,
            plannedWeightKg: 60,
            restSeconds: 90,
            targetRpe: 8,
            targetRir: 2,
          },
          {
            plannedReps: 8,
            plannedWeightKg: 60,
            restSeconds: 90,
            targetRpe: 8,
            targetRir: 2,
          },
        ],
      },
    ],
  };

  const plannedWorkout = {
    id: 'workout-1',
    title: 'Upper Body',
    athleteId: athlete.id,
    createdById: athlete.id,
    status: 'PLANNED',
    exercises: [
      {
        id: 'workout-exercise-1',
        exerciseId: 'exercise-1',
        exerciseNameSnapshot: 'Bench Press',
        sets: [
          {
            id: 'set-1',
            setNumber: 1,
            status: 'PENDING',
            plannedReps: 10,
            plannedWeightKg: 60,
          },
          {
            id: 'set-2',
            setNumber: 2,
            status: 'PENDING',
            plannedReps: 8,
            plannedWeightKg: 60,
          },
        ],
      },
    ],
  };

  const trainerAthletesService = {
    getExerciseAccessContext: vi.fn(),
  };

  const exerciseAccess = {
    activeTrainerIds: [],
    activeAthleteIds: [],
  };

  beforeEach(() => {
    vi.resetAllMocks();

    exercisesService.findAvailableForWorkout.mockResolvedValue([
      availableExercise,
    ]);

    trainerAthletesService.getExerciseAccessContext.mockResolvedValue(
      exerciseAccess,
    );

    service = new WorkoutsService(
      repository as unknown as WorkoutsRepository,
      exercisesService as unknown as ExercisesService,
      trainerAthletesService as unknown as TrainerAthletesService,
    );
  });

  it('should use active trainer access when creating a workout', async () => {
    const access = {
      activeTrainerIds: ['trainer-1'],
      activeAthleteIds: [],
    };

    trainerAthletesService.getExerciseAccessContext.mockResolvedValue(access);

    repository.create.mockResolvedValue(plannedWorkout);

    await service.create(athlete, createInput);

    expect(
      trainerAthletesService.getExerciseAccessContext,
    ).toHaveBeenCalledWith(athlete);

    expect(exercisesService.findAvailableForWorkout).toHaveBeenCalledWith(
      athlete,
      ['exercise-1'],
      access,
    );
  });

  describe('createFromProgram', () => {
    const input: CreateWorkoutFromProgramInput = {
      assignmentId: 'assignment-1',
      programWorkoutId: 'program-workout-1',
      scheduledAt: new Date('2030-01-15T10:00:00.000Z'),
    };

    const workoutFromProgram = {
      id: 'workout-1',
      title: 'Upper Body',
      athleteId: athlete.id,
      createdById: athlete.id,
      status: 'PLANNED',
      programAssignmentId: input.assignmentId,
      programWorkoutId: input.programWorkoutId,
    };

    it('should create a workout from an assigned program', async () => {
      repository.createFromProgram.mockResolvedValue(workoutFromProgram);

      const result = await service.createFromProgram(athlete, input);

      expect(result).toEqual(workoutFromProgram);

      expect(repository.createFromProgram).toHaveBeenCalledWith({
        athleteId: athlete.id,
        assignmentId: input.assignmentId,
        programWorkoutId: input.programWorkoutId,
        scheduledAt: input.scheduledAt,
      });
    });

    it('should reject non-athletes', async () => {
      await expect(service.createFromProgram(trainer, input)).rejects.toThrow(
        ForbiddenException,
      );

      expect(repository.createFromProgram).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when assignment or workout is unavailable', async () => {
      repository.createFromProgram.mockResolvedValue(null);

      await expect(service.createFromProgram(athlete, input)).rejects.toThrow(
        NotFoundException,
      );

      expect(repository.createFromProgram).toHaveBeenCalledOnce();
    });
  });

  describe('create', () => {
    it('should create a workout with exercises and planned sets', async () => {
      repository.create.mockResolvedValue(plannedWorkout);

      const result = await service.create(athlete, createInput);

      expect(result).toEqual(plannedWorkout);

      expect(exercisesService.findAvailableForWorkout).toHaveBeenCalledWith(
        athlete,
        ['exercise-1'],
        {
          activeTrainerIds: [],
          activeAthleteIds: [],
        },
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Upper Body',
          notes: 'Push workout',
          athlete: {
            connect: { id: athlete.id },
          },
          createdBy: {
            connect: { id: athlete.id },
          },
          exercises: {
            create: [
              expect.objectContaining({
                exerciseNameSnapshot: 'Bench Press',
                exerciseTypeSnapshot: 'STRENGTH',
                sortOrder: 0,
                sets: {
                  create: [
                    expect.objectContaining({
                      setNumber: 1,
                      plannedReps: 10,
                      plannedWeightKg: 60,
                      targetRpe: 8,
                      targetRir: 2,
                      setType: 'WORKING',
                    }),
                    expect.objectContaining({
                      setNumber: 2,
                      plannedReps: 8,
                      plannedWeightKg: 60,
                    }),
                  ],
                },
              }),
            ],
          },
        }),
      );
    });

    it('should reject non-athletes', async () => {
      await expect(service.create(trainer, createInput)).rejects.toThrow(
        ForbiddenException,
      );

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should reject a workout without exercises', async () => {
      await expect(
        service.create(athlete, {
          ...createInput,
          exercises: [],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should reject an exercise without sets', async () => {
      await expect(
        service.create(athlete, {
          ...createInput,
          exercises: [
            {
              exerciseId: 'exercise-1',
              sets: [],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should reject unavailable exercises', async () => {
      exercisesService.findAvailableForWorkout.mockRejectedValue(
        new BadRequestException('One or more exercises are not available'),
      );

      await expect(service.create(athlete, createInput)).rejects.toThrow(
        BadRequestException,
      );

      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('findMany', () => {
    it('should return workouts with pagination', async () => {
      const response = {
        data: [plannedWorkout],
        meta: {
          total: 1,
          skip: 0,
          take: 10,
          totalPages: 1,
        },
      };

      repository.findMany.mockResolvedValue(response);

      const result = await service.findMany(athlete, {
        page: 1,
        limit: 10,
      });

      expect(result).toEqual(response);

      expect(repository.findMany).toHaveBeenCalledWith({
        where: {
          athleteId: athlete.id,
        },
        skip: 0,
        take: 10,
      });
    });

    it('should filter by status and scheduled date', async () => {
      repository.findMany.mockResolvedValue({
        data: [],
        meta: {},
      });

      const scheduledFrom = new Date('2026-11-01T00:00:00.000Z');
      const scheduledTo = new Date('2026-11-30T23:59:59.000Z');

      await service.findMany(athlete, {
        page: 1,
        limit: 20,
        status: 'PLANNED',
        scheduledFrom,
        scheduledTo,
      });

      expect(repository.findMany).toHaveBeenCalledWith({
        where: {
          athleteId: athlete.id,
          status: 'PLANNED',
          scheduledAt: {
            gte: scheduledFrom,
            lte: scheduledTo,
          },
        },
        skip: 0,
        take: 20,
      });
    });

    it('should reject invalid pagination', async () => {
      await expect(
        service.findMany(athlete, {
          page: 0,
          limit: 10,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.findMany).not.toHaveBeenCalled();
    });

    it('should reject an invalid scheduled date range', async () => {
      await expect(
        service.findMany(athlete, {
          page: 1,
          limit: 10,
          scheduledFrom: new Date('2026-11-30'),
          scheduledTo: new Date('2026-11-01'),
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a workout owned by the athlete', async () => {
      repository.findById.mockResolvedValue(plannedWorkout);

      const result = await service.findOne('workout-1', athlete);

      expect(result).toEqual(plannedWorkout);

      expect(repository.findById).toHaveBeenCalledWith('workout-1', {
        athleteId: athlete.id,
      });
    });

    it('should hide workouts belonging to another athlete', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findOne('workout-1', athlete)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject non-athletes', async () => {
      await expect(service.findOne('workout-1', trainer)).rejects.toThrow(
        ForbiddenException,
      );

      expect(repository.findById).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should allow editing a planned workout', async () => {
      repository.findById.mockResolvedValue(plannedWorkout);
      repository.update.mockResolvedValue({
        ...plannedWorkout,
        title: 'Updated Upper Body',
      });

      const result = await service.update('workout-1', athlete, {
        title: 'Updated Upper Body',
      });

      expect(result.title).toBe('Updated Upper Body');

      expect(repository.update).toHaveBeenCalledWith(
        {
          id: 'workout-1',
          athleteId: athlete.id,
          status: 'PLANNED',
        },
        {
          title: 'Updated Upper Body',
        },
      );
    });

    it('should reject editing a completed workout', async () => {
      repository.findById.mockResolvedValue({
        ...plannedWorkout,
        status: 'COMPLETED',
      });

      await expect(
        service.update('workout-1', athlete, {
          title: 'Updated title',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('start', () => {
    it('should start a planned workout', async () => {
      repository.findById.mockResolvedValue(plannedWorkout);

      repository.startWorkout.mockResolvedValue({
        ...plannedWorkout,
        status: 'IN_PROGRESS',
      });

      const result = await service.start('workout-1', athlete);

      expect(result.status).toBe('IN_PROGRESS');

      expect(repository.startWorkout).toHaveBeenCalledWith({
        id: 'workout-1',
        athleteId: athlete.id,
        startedAt: expect.any(Date),
      });

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should reject starting an already started workout', async () => {
      repository.findById.mockResolvedValue({
        ...plannedWorkout,
        status: 'IN_PROGRESS',
      });

      await expect(service.start('workout-1', athlete)).rejects.toThrow(
        BadRequestException,
      );

      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('updateSet', () => {
    it('should record actual set performance', async () => {
      repository.findById.mockResolvedValue({
        ...plannedWorkout,
        status: 'IN_PROGRESS',
      });

      repository.updateSet.mockResolvedValue({
        id: 'set-1',
        status: 'COMPLETED',
        actualReps: 8,
        actualWeightKg: 60,
      });

      const result = await service.updateSet('workout-1', 'set-1', athlete, {
        status: 'COMPLETED',
        actualReps: 8,
        actualWeightKg: 60,
        rpe: 8,
      });

      expect(result.status).toBe('COMPLETED');

      expect(repository.updateSet).toHaveBeenCalledWith(
        'set-1',
        expect.objectContaining({
          status: 'COMPLETED',
          actualReps: 8,
          actualWeightKg: 60,
          rpe: 8,
          completedAt: expect.any(Date),
        }),
      );
    });

    it('should reject updating sets outside an active workout', async () => {
      repository.findById.mockResolvedValue(plannedWorkout);

      await expect(
        service.updateSet('workout-1', 'set-1', athlete, {
          status: 'COMPLETED',
          actualReps: 8,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.updateSet).not.toHaveBeenCalled();
    });

    it('should reject a set belonging to another workout', async () => {
      repository.findById.mockResolvedValue({
        ...plannedWorkout,
        status: 'IN_PROGRESS',
      });

      await expect(
        service.updateSet('workout-1', 'unknown-set', athlete, {
          status: 'COMPLETED',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(repository.updateSet).not.toHaveBeenCalled();
    });

    it('should reject actual values for skipped sets', async () => {
      repository.findById.mockResolvedValue({
        ...plannedWorkout,
        status: 'IN_PROGRESS',
      });

      await expect(
        service.updateSet('workout-1', 'set-1', athlete, {
          status: 'SKIPPED',
          actualReps: 8,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.updateSet).not.toHaveBeenCalled();
    });

    it('should reject a set update when workout state changes concurrently', async () => {
      repository.findById.mockResolvedValue({
        ...plannedWorkout,
        status: 'IN_PROGRESS',
      });

      // Repository detects the completed workout under row lock.
      repository.updateSet.mockResolvedValue(null);

      await expect(
        service.updateSet('workout-1', 'set-1', athlete, {
          status: 'COMPLETED',
          actualReps: 8,
          actualWeightKg: 60,
        }),
      ).rejects.toThrow(ConflictException);

      expect(repository.updateSet).toHaveBeenCalledOnce();
    });
  });

  describe('complete', () => {
    it('should complete a workout when all sets are processed', async () => {
      repository.findById.mockResolvedValue({
        ...plannedWorkout,
        status: 'IN_PROGRESS',
        exercises: [
          {
            ...plannedWorkout.exercises[0],
            sets: [
              { id: 'set-1', status: 'COMPLETED' },
              { id: 'set-2', status: 'SKIPPED' },
            ],
          },
        ],
      });

      // Arrange
      repository.completeWorkout.mockResolvedValue({
        status: 'COMPLETED',
        workout: {
          ...plannedWorkout,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      // Act
      const result = await service.complete('workout-1', athlete);

      // Assert
      expect(result.status).toBe('COMPLETED');
      expect(result.completedAt).toBeInstanceOf(Date);

      expect(repository.completeWorkout).toHaveBeenCalledOnce();

      expect(repository.completeWorkout).toHaveBeenCalledWith({
        id: 'workout-1',
        athleteId: athlete.id,
        completedAt: expect.any(Date),
      });

      // Legacy update must not be used for completion.
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should reject completion when pending sets remain', async () => {
      repository.findById.mockResolvedValue({
        ...plannedWorkout,
        status: 'IN_PROGRESS',
      });

      await expect(service.complete('workout-1', athlete)).rejects.toThrow(
        BadRequestException,
      );

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should reject completion when all sets were skipped', async () => {
      repository.findById.mockResolvedValue({
        ...plannedWorkout,
        status: 'IN_PROGRESS',
        exercises: [
          {
            ...plannedWorkout.exercises[0],
            sets: [
              { id: 'set-1', status: 'SKIPPED' },
              { id: 'set-2', status: 'SKIPPED' },
            ],
          },
        ],
      });

      await expect(service.complete('workout-1', athlete)).rejects.toThrow(
        BadRequestException,
      );

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should reject completion when no sets exist', async () => {
      repository.findById.mockResolvedValue({
        ...plannedWorkout,
        status: 'IN_PROGRESS',
        exercises: [],
      });

      await expect(service.complete('workout-1', athlete)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject completion if set results changed after initial validation', async () => {
      repository.findById.mockResolvedValue({
        ...plannedWorkout,
        status: 'IN_PROGRESS',
        exercises: [
          {
            ...plannedWorkout.exercises[0],
            sets: [
              { id: 'set-1', status: 'COMPLETED' },
              { id: 'set-2', status: 'SKIPPED' },
            ],
          },
        ],
      });

      repository.completeWorkout.mockResolvedValue({
        status: 'INVALID_SETS',
      });

      await expect(service.complete('workout-1', athlete)).rejects.toThrow(
        ConflictException,
      );

      expect(repository.completeWorkout).toHaveBeenCalledWith({
        id: 'workout-1',
        athleteId: athlete.id,
        completedAt: expect.any(Date),
      });
    });
  });

  describe('cancel', () => {
    it('should cancel a planned workout', async () => {
      repository.findById.mockResolvedValue(plannedWorkout);
      repository.update.mockResolvedValue({
        ...plannedWorkout,
        status: 'CANCELLED',
      });

      const result = await service.cancel('workout-1', athlete);

      expect(result.status).toBe('CANCELLED');

      expect(repository.update).toHaveBeenCalledWith(
        {
          id: 'workout-1',
          athleteId: athlete.id,
          status: 'PLANNED',
        },
        { status: 'CANCELLED' },
      );
    });

    it('should reject cancelling a completed workout', async () => {
      repository.findById.mockResolvedValue({
        ...plannedWorkout,
        status: 'COMPLETED',
      });

      await expect(service.cancel('workout-1', athlete)).rejects.toThrow(
        BadRequestException,
      );

      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('concurrent updates', () => {
    it('should convert Prisma P2025 into ConflictException', async () => {
      repository.findById.mockResolvedValue(plannedWorkout);

      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Record not found',
        {
          code: 'P2025',
          clientVersion: '7.10.1',
        },
      );

      repository.startWorkout.mockRejectedValue(prismaError);

      await expect(service.start('workout-1', athlete)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
