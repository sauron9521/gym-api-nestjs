import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { TrainingProgramsService } from '../training-programs.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';
import { ExercisesService } from '../../exercises/exercises.service.js';
import { TrainerAthletesService } from '../../trainer-athletes/trainer-athletes.service.js';
import { TrainingProgramAccessService } from '../services/training-program-access.service.js';
import { TrainingProgramWorkoutService } from '../services/training-program-workout.service.js';
import { TrainingProgramExerciseService } from '../services/training-program-exercise.service.js';
import { TrainingProgramSetService } from '../services/training-program-set.service.js';
import { TrainingProgramCrudService } from '../services/training-program-crud.service.js';
import { TrainingProgramVersionService } from '../services/training-program-version.service.js';
import { TrainingProgramAssignmentService } from '../services/training-program-assignment.service.js';

import { TrainingProgramWorkoutRepository } from '../repositories/training-program-workout.repository.js';
import { TrainingProgramExerciseRepository } from '../repositories/training-program-exercise.repository.js';
import { TrainingProgramCrudRepository } from '../repositories/training-program-crud.repository.js';
import { TrainingProgramVersionRepository } from '../repositories/training-program-version.repository.js';
import { TrainingProgramAssignmentRepository } from '../repositories/training-program-assignment.repository.js';
import { TrainingProgramSetRepository } from '../repositories/training-program-set.repository.js';

describe('TrainingProgramsService', () => {
  let service: TrainingProgramsService;

  const repository = {
    createProgramWithDraft: vi.fn(),
    findMany: vi.fn(),
    findProgramById: vi.fn(),
    findVersions: vi.fn(),
    findVersionById: vi.fn(),
    findDraftVersion: vi.fn(),
    createDraftFromLatestPublished: vi.fn(),
    updateVersion: vi.fn(),
    publishVersion: vi.fn(),
    updateProgram: vi.fn(),
    createWorkout: vi.fn(),
    updateWorkout: vi.fn(),
    deleteWorkout: vi.fn(),
    createProgramExercise: vi.fn(),
    updateProgramExercise: vi.fn(),
    deleteProgramExercise: vi.fn(),
    reorderProgramExercises: vi.fn(),
    createProgramSet: vi.fn(),
    updateProgramSet: vi.fn(),
    deleteProgramSet: vi.fn(),
    reorderProgramSets: vi.fn(),
    createAssignmentForActiveRelationship: vi.fn(),
    findManyAssignments: vi.fn(),
    findAssignmentById: vi.fn(),
    findAssignmentDetailsById: vi.fn(),
    updateAssignment: vi.fn(),
    completeAssignmentIfNoUnfinishedWorkouts: vi.fn(),
    findManyAssignmentsForTrainer: vi.fn(),
    findHistoricalAssignmentDetailsById: vi.fn(),
  };

  const exercisesServiceMock = {
    findOne: vi.fn(),
    findAvailableForTrainingProgram: vi.fn(),
  };

  const trainerAthletesServiceMock = {
    getExerciseAccessContext: vi.fn(),
    findOne: vi.fn(),
  };

  const trainer: TrainingProgramActor = {
    id: 'trainer-1',
    role: 'TRAINER',
  };

  const athlete: TrainingProgramActor = {
    id: 'athlete-1',
    role: 'ATHLETE',
  };

  const program = {
    id: 'program-1',
    trainerId: trainer.id,
    status: 'DRAFT',
    versions: [
      {
        id: 'version-1',
        version: 1,
        title: 'Beginner Program',
        status: 'DRAFT',
      },
    ],
  };

  const activeAssignment = {
    id: 'assignment-1',
    athleteId: 'athlete-1',
    status: 'ACTIVE',
  };

  const relationship = {
    id: 'relationship-1',
    trainerId: trainer.id,
    athleteId: 'athlete-1',
    status: 'ACTIVE',
  };

  const draftVersion = {
    id: 'version-1',
    programId: 'program-1',
    version: 1,
    title: 'Beginner Program',
    description: null,
    durationWeeks: 4,
    status: 'DRAFT',
    publishedAt: null,
    workouts: [
      {
        id: 'program-workout-1',
        weekNumber: 1,
        dayNumber: 1,
        title: 'Upper Body',
        notes: null,
        exercises: [
          {
            id: 'program-exercise-1',
            exerciseId: 'exercise-1',
            exerciseNameSnapshot: 'Bench Press',
            exerciseTypeSnapshot: 'STRENGTH',
            sortOrder: 0,
            notes: null,
            sets: [
              {
                id: 'program-set-1',
                setNumber: 1,
                setType: 'WORKING',
                plannedReps: 10,
                plannedWeightKg: 60,
              },
            ],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.resetAllMocks();

    const crudRepositoryMock = {
      createProgramWithDraft: repository.createProgramWithDraft,
      findMany: repository.findMany,
      findProgramById: repository.findProgramById,
      createProgram: vi.fn(),
      updateProgram: repository.updateProgram,
    } as unknown as TrainingProgramCrudRepository;

    const versionRepositoryMock = {
      findVersions: repository.findVersions,
      findVersionById: repository.findVersionById,
      // Share the mock so existing business tests cover the same access
      // outcomes while the repository verifies the compact DB select.
      findVersionForEditing: repository.findVersionById,
      findDraftVersion: repository.findDraftVersion,
      createDraftFromLatestPublished: repository.createDraftFromLatestPublished,
      updateVersion: repository.updateVersion,
      publishVersion: repository.publishVersion,
    } as unknown as TrainingProgramVersionRepository;

    const assignmentRepositoryMock = {
      createAssignmentForActiveRelationship:
        repository.createAssignmentForActiveRelationship,
      findManyAssignments: repository.findManyAssignments,
      findAssignmentById: repository.findAssignmentById,
      findAssignmentDetailsById: repository.findAssignmentDetailsById,
      updateAssignment: repository.updateAssignment,
      completeAssignmentIfNoUnfinishedWorkouts:
        repository.completeAssignmentIfNoUnfinishedWorkouts,
      findManyAssignmentsForTrainer: repository.findManyAssignmentsForTrainer,
      findHistoricalAssignmentDetailsById:
        repository.findHistoricalAssignmentDetailsById,
    } as unknown as TrainingProgramAssignmentRepository;

    const exerciseRepositoryMock = {
      createProgramExercise: repository.createProgramExercise,
      updateProgramExercise: repository.updateProgramExercise,
      deleteProgramExercise: repository.deleteProgramExercise,
      reorderProgramExercises: repository.reorderProgramExercises,
    } as unknown as TrainingProgramExerciseRepository;

    const workoutRepositoryMock = {
      createWorkout: repository.createWorkout,
      updateWorkout: repository.updateWorkout,
      deleteWorkout: repository.deleteWorkout,
    } as unknown as TrainingProgramWorkoutRepository;

    const setRepositoryMock = {
      createProgramSet: repository.createProgramSet,
      updateProgramSet: repository.updateProgramSet,
      deleteProgramSet: repository.deleteProgramSet,
      reorderProgramSets: repository.reorderProgramSets,
    } as unknown as TrainingProgramSetRepository;

    const accessService = new TrainingProgramAccessService(
      crudRepositoryMock,
      versionRepositoryMock,
    );

    const crudService = new TrainingProgramCrudService(
      crudRepositoryMock,
      accessService,
    );

    const versionService = new TrainingProgramVersionService(
      versionRepositoryMock,
      crudService,
    );

    const exercisesService =
      exercisesServiceMock as unknown as ExercisesService;

    const workoutService = new TrainingProgramWorkoutService(
      workoutRepositoryMock,
      accessService,
    );

    const exerciseService = new TrainingProgramExerciseService(
      exerciseRepositoryMock,
      exercisesService,
      accessService,
    );

    const setService = new TrainingProgramSetService(
      setRepositoryMock,
      accessService,
    );

    const assignmentService = new TrainingProgramAssignmentService(
      assignmentRepositoryMock,
      crudService,
      versionService,
      accessService,
      trainerAthletesServiceMock as unknown as TrainerAthletesService,
    );

    service = new TrainingProgramsService(
      crudService,
      versionService,
      assignmentService,
      workoutService,
      exerciseService,
      setService,
    );
  });

  describe('addExercise', () => {
    it('should add an available exercise to a workout', async () => {
      // Arrange: mock program and draft version.
      repository.findProgramById.mockResolvedValue(program);
      repository.findVersionById.mockResolvedValue(draftVersion);

      // Arrange: mock available exercise.
      const exercise = {
        id: 'exercise-1',
        name: 'Bench Press',
        exerciseType: 'STRENGTH',
      };

      exercisesServiceMock.findAvailableForTrainingProgram.mockResolvedValue(
        exercise,
      );

      repository.createProgramExercise.mockResolvedValue({
        id: 'program-exercise-new',
      });

      // Act.
      const result = await service.addExercise(
        trainer,
        'program-1',
        'version-1',
        'program-workout-1',
        {
          exerciseId: 'exercise-1',
          notes: 'Controlled tempo',
        },
      );

      // Assert.
      expect(
        exercisesServiceMock.findAvailableForTrainingProgram,
      ).toHaveBeenCalledWith('exercise-1', trainer);

      expect(repository.createProgramExercise).toHaveBeenCalledWith(
        'program-1',
        'version-1',
        'program-workout-1',
        {
          exerciseId: 'exercise-1',
          exerciseNameSnapshot: 'Bench Press',
          exerciseTypeSnapshot: 'STRENGTH',
          sortOrder: 1,
          notes: 'Controlled tempo',
        },
      );

      expect(result).toEqual({
        id: 'program-exercise-new',
      });
    });

    it('should return ConflictException when the draft is published concurrently', async () => {
      repository.findProgramById.mockResolvedValue(program);
      repository.findVersionById.mockResolvedValue(draftVersion);

      exercisesServiceMock.findAvailableForTrainingProgram.mockResolvedValue({
        id: 'exercise-1',
        name: 'Bench Press',
        exerciseType: 'STRENGTH',
      });

      repository.createProgramExercise.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record to update not found', {
          code: 'P2025',
          clientVersion: '7.10.1',
        }),
      );

      await expect(
        service.addExercise(
          trainer,
          'program-1',
          'version-1',
          'program-workout-1',
          {
            exerciseId: 'exercise-1',
          },
        ),
      ).rejects.toThrow(ConflictException);

      expect(repository.createProgramExercise).toHaveBeenCalledTimes(1);
    });
  });

  describe('create', () => {
    it('should create a program with its first draft', async () => {
      const created = {
        ...program,
        status: 'DRAFT',
      };

      repository.createProgramWithDraft.mockResolvedValue(created);

      const result = await service.create(trainer, {
        title: ' Beginner Program ',
        description: '  Build strength  ',
        durationWeeks: 4,
      });

      expect(repository.createProgramWithDraft).toHaveBeenCalledWith({
        trainerId: trainer.id,
        title: 'Beginner Program',
        description: 'Build strength',
        durationWeeks: 4,
      });

      expect(result).toEqual(created);
    });

    it('should reject non-trainers', async () => {
      await expect(
        service.create(athlete, {
          title: 'Beginner Program',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.createProgramWithDraft).not.toHaveBeenCalled();
    });

    it('should normalize optional fields', async () => {
      repository.createProgramWithDraft.mockResolvedValue(program);

      await service.create(trainer, {
        title: 'Beginner Program',
      });

      expect(repository.createProgramWithDraft).toHaveBeenCalledWith({
        trainerId: trainer.id,
        title: 'Beginner Program',
        description: null,
        durationWeeks: null,
      });
    });
  });

  describe('findMany', () => {
    it('should return only programs belonging to the trainer', async () => {
      const response = {
        data: [program],
        meta: {
          total: 1,
          skip: 0,
          take: 20,
          totalPages: 1,
        },
      };

      repository.findMany.mockResolvedValue(response);

      const result = await service.findMany(trainer, {
        page: 1,
        limit: 20,
        status: 'DRAFT',
      });

      expect(repository.findMany).toHaveBeenCalledWith({
        where: {
          trainerId: trainer.id,
          status: 'DRAFT',
        },
        skip: 0,
        take: 20,
      });

      expect(result).toEqual(response);
    });

    it('should reject invalid pagination', async () => {
      await expect(
        service.findMany(trainer, {
          page: 0,
          limit: 20,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a program owned by the trainer', async () => {
      repository.findProgramById.mockResolvedValue(program);

      const result = await service.findOne('program-1', trainer);

      expect(repository.findProgramById).toHaveBeenCalledWith('program-1', {
        trainerId: trainer.id,
      });

      expect(result).toEqual(program);
    });

    it('should hide another trainer program', async () => {
      repository.findProgramById.mockResolvedValue(null);

      await expect(service.findOne('program-1', trainer)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findVersions', () => {
    it('should return versions of an owned program', async () => {
      repository.findProgramById.mockResolvedValue(program);

      const versions = [{ id: 'version-1', version: 1 }];

      repository.findVersions.mockResolvedValue(versions);

      const result = await service.findVersions('program-1', trainer);

      expect(repository.findVersions).toHaveBeenCalledWith('program-1');
      expect(result).toEqual(versions);
    });
  });

  describe('createNextDraft', () => {
    it('should create the next draft from the latest published version', async () => {
      repository.findProgramById.mockResolvedValue({
        ...program,
        status: 'PUBLISHED',
      });

      repository.findDraftVersion.mockResolvedValue(null);
      repository.createDraftFromLatestPublished.mockResolvedValue({
        ...draftVersion,
        version: 2,
      });

      const result = await service.createNextDraft('program-1', trainer);

      expect(repository.findDraftVersion).toHaveBeenCalledWith('program-1');

      expect(repository.createDraftFromLatestPublished).toHaveBeenCalledWith(
        'program-1',
      );

      expect(result.version).toBe(2);
    });

    it('should reject creating a second draft', async () => {
      repository.findProgramById.mockResolvedValue(program);
      repository.findDraftVersion.mockResolvedValue(draftVersion);

      await expect(
        service.createNextDraft('program-1', trainer),
      ).rejects.toThrow(ConflictException);

      expect(repository.createDraftFromLatestPublished).not.toHaveBeenCalled();
    });

    it('should reject creating a draft for an archived program', async () => {
      repository.findProgramById.mockResolvedValue({
        ...program,
        status: 'ARCHIVED',
      });

      await expect(
        service.createNextDraft('program-1', trainer),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject when no published version exists', async () => {
      repository.findProgramById.mockResolvedValue(program);
      repository.findDraftVersion.mockResolvedValue(null);
      repository.createDraftFromLatestPublished.mockResolvedValue(null);

      await expect(
        service.createNextDraft('program-1', trainer),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateDraftVersion', () => {
    it('rejects reducing duration below an existing workout week', async () => {
      repository.findProgramById.mockResolvedValue(program);
      repository.findVersionById.mockResolvedValue({
        ...draftVersion,
        workouts: [{ ...draftVersion.workouts[0], weekNumber: 5 }],
      });

      await expect(
        service.updateDraftVersion('program-1', 'version-1', trainer, {
          durationWeeks: 4,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.updateVersion).not.toHaveBeenCalled();
    });

    it('should update a draft version', async () => {
      repository.findProgramById.mockResolvedValue(program);
      repository.findVersionById.mockResolvedValue(draftVersion);

      const updated = {
        ...draftVersion,
        title: 'Updated Beginner Program',
      };

      repository.updateVersion.mockResolvedValue(updated);

      const result = await service.updateDraftVersion(
        'program-1',
        'version-1',
        trainer,
        {
          title: 'Updated Beginner Program',
        },
      );

      expect(repository.updateVersion).toHaveBeenCalledWith(
        {
          id: 'version-1',
          programId: 'program-1',
          status: 'DRAFT',
        },
        {
          title: 'Updated Beginner Program',
        },
      );

      expect(result.title).toBe('Updated Beginner Program');
    });

    it('should reject editing a published version', async () => {
      repository.findProgramById.mockResolvedValue({
        ...program,
        status: 'PUBLISHED',
      });

      repository.findVersionById.mockResolvedValue({
        ...draftVersion,
        status: 'PUBLISHED',
      });

      await expect(
        service.updateDraftVersion('program-1', 'version-1', trainer, {
          title: 'Modified',
        }),
      ).rejects.toThrow(ConflictException);

      expect(repository.updateVersion).not.toHaveBeenCalled();
    });

    it('should reject an empty update', async () => {
      repository.findProgramById.mockResolvedValue(program);
      repository.findVersionById.mockResolvedValue(draftVersion);

      await expect(
        service.updateDraftVersion('program-1', 'version-1', trainer, {}),
      ).rejects.toThrow(BadRequestException);

      expect(repository.updateVersion).not.toHaveBeenCalled();
    });
  });

  describe('publishVersion', () => {
    it('rejects publishing if a workout exceeds the declared duration', async () => {
      repository.findProgramById.mockResolvedValue(program);
      repository.findVersionById.mockResolvedValue({
        ...draftVersion,
        durationWeeks: 2,
        workouts: [{ ...draftVersion.workouts[0], weekNumber: 3 }],
      });
      await expect(
        service.publishVersion('program-1', 'version-1', trainer),
      ).rejects.toThrow(BadRequestException);
      expect(repository.publishVersion).not.toHaveBeenCalled();
    });

    it('should publish a valid draft version', async () => {
      repository.findProgramById.mockResolvedValue(program);
      repository.findVersionById.mockResolvedValue(draftVersion);

      const published = {
        ...draftVersion,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      };

      repository.publishVersion.mockResolvedValue(published);

      const result = await service.publishVersion(
        'program-1',
        'version-1',
        trainer,
      );

      expect(repository.publishVersion).toHaveBeenCalledWith(
        'program-1',
        'version-1',
      );

      expect(result).toEqual(published);
    });

    it('should reject publishing an empty program', async () => {
      repository.findProgramById.mockResolvedValue(program);
      repository.findVersionById.mockResolvedValue({
        ...draftVersion,
        workouts: [],
      });

      await expect(
        service.publishVersion('program-1', 'version-1', trainer),
      ).rejects.toThrow(BadRequestException);

      expect(repository.publishVersion).not.toHaveBeenCalled();
    });

    it('should reject a workout without exercises', async () => {
      repository.findProgramById.mockResolvedValue(program);
      repository.findVersionById.mockResolvedValue({
        ...draftVersion,
        workouts: [
          {
            ...draftVersion.workouts[0],
            exercises: [],
          },
        ],
      });

      await expect(
        service.publishVersion('program-1', 'version-1', trainer),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject an exercise without sets', async () => {
      repository.findProgramById.mockResolvedValue(program);
      repository.findVersionById.mockResolvedValue({
        ...draftVersion,
        workouts: [
          {
            ...draftVersion.workouts[0],
            exercises: [
              {
                ...draftVersion.workouts[0].exercises[0],
                sets: [],
              },
            ],
          },
        ],
      });

      await expect(
        service.publishVersion('program-1', 'version-1', trainer),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject publishing an already published version', async () => {
      repository.findProgramById.mockResolvedValue({
        ...program,
        status: 'PUBLISHED',
      });

      repository.findVersionById.mockResolvedValue({
        ...draftVersion,
        status: 'PUBLISHED',
      });

      await expect(
        service.publishVersion('program-1', 'version-1', trainer),
      ).rejects.toThrow(ConflictException);

      expect(repository.publishVersion).not.toHaveBeenCalled();
    });

    it('should reject publishing when the version state changed concurrently', async () => {
      repository.findProgramById.mockResolvedValue(program);
      repository.findVersionById.mockResolvedValue(draftVersion);
      repository.publishVersion.mockResolvedValue(null);

      await expect(
        service.publishVersion('program-1', 'version-1', trainer),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('archive', () => {
    it('should archive an owned program', async () => {
      repository.findProgramById.mockResolvedValue({
        ...program,
        status: 'PUBLISHED',
      });

      const archived = {
        ...program,
        status: 'ARCHIVED',
      };

      repository.updateProgram.mockResolvedValue(archived);

      const result = await service.archive('program-1', trainer);

      expect(repository.updateProgram).toHaveBeenCalledWith(
        {
          id: 'program-1',
          trainerId: trainer.id,
          status: { not: 'ARCHIVED' },
        },
        {
          status: 'ARCHIVED',
        },
      );

      expect(result).toEqual(archived);
    });

    it('should reject archiving an already archived program', async () => {
      repository.findProgramById.mockResolvedValue({
        ...program,
        status: 'ARCHIVED',
      });

      await expect(service.archive('program-1', trainer)).rejects.toThrow(
        ConflictException,
      );

      expect(repository.updateProgram).not.toHaveBeenCalled();
    });
  });

  describe('assignVersionToAthlete', () => {
    const publishedProgram = {
      ...program,
      status: 'PUBLISHED',
    };

    const publishedVersion = {
      ...draftVersion,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    };

    const input = {
      trainerAthleteId: relationship.id,
    };

    beforeEach(() => {
      repository.findProgramById.mockResolvedValue(publishedProgram);
      repository.findVersionById.mockResolvedValue(publishedVersion);
      trainerAthletesServiceMock.findOne.mockResolvedValue(relationship);
    });

    it('should assign a published version to an active athlete', async () => {
      const assignment = {
        id: 'assignment-1',
        versionId: publishedVersion.id,
        athleteId: relationship.athleteId,
        status: 'ACTIVE',
      };

      repository.createAssignmentForActiveRelationship.mockResolvedValue(
        assignment,
      );

      const result = await service.assignVersionToAthlete(
        trainer,
        'program-1',
        'version-1',
        input,
      );

      expect(trainerAthletesServiceMock.findOne).toHaveBeenCalledWith(
        relationship.id,
        trainer,
      );

      expect(
        repository.createAssignmentForActiveRelationship,
      ).toHaveBeenCalledWith({
        programId: 'program-1',
        versionId: 'version-1',
        trainerAthleteId: relationship.id,
        trainerId: trainer.id,
        athleteId: relationship.athleteId,
      });

      expect(result).toEqual(assignment);
    });

    it('should reject assignment when relationship is no longer active', async () => {
      repository.createAssignmentForActiveRelationship.mockResolvedValue(null);

      await expect(
        service.assignVersionToAthlete(
          trainer,
          'program-1',
          'version-1',
          input,
        ),
      ).rejects.toThrow(ConflictException);

      expect(
        repository.createAssignmentForActiveRelationship,
      ).toHaveBeenCalledWith({
        programId: 'program-1',
        versionId: 'version-1',
        trainerAthleteId: relationship.id,
        trainerId: trainer.id,
        athleteId: relationship.athleteId,
      });
    });

    it('should reject non-trainers', async () => {
      await expect(
        service.assignVersionToAthlete(
          athlete,
          'program-1',
          'version-1',
          input,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(
        repository.createAssignmentForActiveRelationship,
      ).not.toHaveBeenCalled();
    });

    it('should reject an archived program', async () => {
      repository.findProgramById.mockResolvedValue({
        ...publishedProgram,
        status: 'ARCHIVED',
      });

      await expect(
        service.assignVersionToAthlete(
          trainer,
          'program-1',
          'version-1',
          input,
        ),
      ).rejects.toThrow(ConflictException);

      expect(trainerAthletesServiceMock.findOne).not.toHaveBeenCalled();
    });

    it('should reject a draft version', async () => {
      repository.findVersionById.mockResolvedValue(draftVersion);

      await expect(
        service.assignVersionToAthlete(
          trainer,
          'program-1',
          'version-1',
          input,
        ),
      ).rejects.toThrow(ConflictException);

      expect(
        repository.createAssignmentForActiveRelationship,
      ).not.toHaveBeenCalled();
    });

    it('should reject an inactive trainer-athlete relationship', async () => {
      trainerAthletesServiceMock.findOne.mockResolvedValue({
        ...relationship,
        status: 'PENDING',
      });

      await expect(
        service.assignVersionToAthlete(
          trainer,
          'program-1',
          'version-1',
          input,
        ),
      ).rejects.toThrow(ConflictException);

      expect(
        repository.createAssignmentForActiveRelationship,
      ).not.toHaveBeenCalled();
    });

    it('should reject a relationship belonging to another trainer', async () => {
      trainerAthletesServiceMock.findOne.mockResolvedValue({
        ...relationship,
        trainerId: 'another-trainer',
      });

      await expect(
        service.assignVersionToAthlete(
          trainer,
          'program-1',
          'version-1',
          input,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(
        repository.createAssignmentForActiveRelationship,
      ).not.toHaveBeenCalled();
    });

    it('should reject an assignment when the program does not exist', async () => {
      repository.findProgramById.mockResolvedValue(null);

      await expect(
        service.assignVersionToAthlete(
          trainer,
          'program-1',
          'version-1',
          input,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(
        repository.createAssignmentForActiveRelationship,
      ).not.toHaveBeenCalled();
    });

    it('should convert duplicate assignment conflict into ConflictException', async () => {
      repository.createAssignmentForActiveRelationship.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.10.1',
        }),
      );

      await expect(
        service.assignVersionToAthlete(
          trainer,
          'program-1',
          'version-1',
          input,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Prisma conflicts', () => {
    it('should convert concurrent draft creation into ConflictException', async () => {
      repository.findProgramById.mockResolvedValue({
        ...program,
        status: 'PUBLISHED',
      });

      repository.findDraftVersion.mockResolvedValue(null);

      repository.createDraftFromLatestPublished.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.10.1',
        }),
      );

      await expect(
        service.createNextDraft('program-1', trainer),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('assignments lifecycle', () => {
    beforeEach(() => {
      repository.findAssignmentById.mockResolvedValue(activeAssignment);
    });

    it('should return trainer assignments scoped to owned programs', async () => {
      const response = {
        data: [activeAssignment],
        meta: {
          total: 1,
          skip: 0,
          take: 20,
          totalPages: 1,
        },
      };

      repository.findManyAssignmentsForTrainer.mockResolvedValue(response);

      const result = await service.findManyAssignments(trainer, {
        page: 1,
        limit: 20,
        status: 'ACTIVE',
      });

      expect(repository.findManyAssignmentsForTrainer).toHaveBeenCalledWith({
        where: {
          AND: [
            {
              version: {
                program: {
                  trainerId: trainer.id,
                },
              },
            },
            { status: 'ACTIVE' },
          ],
        },
        skip: 0,
        take: 20,
      });

      expect(repository.findManyAssignments).not.toHaveBeenCalled();

      expect(result).toEqual(response);
    });

    it('should scope athlete assignments to current athlete', async () => {
      repository.findManyAssignments.mockResolvedValue({
        data: [],
        meta: {},
      });

      await service.findManyAssignments(athlete, {
        page: 1,
        limit: 20,
      });

      expect(repository.findManyAssignments).toHaveBeenCalledWith({
        where: {
          AND: [{ athleteId: athlete.id }],
        },
        skip: 0,
        take: 20,
      });
    });

    it('should return only an assignment accessible to the athlete', async () => {
      await service.findOneAssignment('assignment-1', athlete);

      expect(repository.findAssignmentById).toHaveBeenCalledWith(
        'assignment-1',
        { athleteId: athlete.id },
      );
    });

    describe('findOneAssignmentDetails', () => {
      it('should return full assignment details for an athlete', async () => {
        const details = {
          ...activeAssignment,
          version: {
            id: 'version-1',
            title: 'Beginner Program',
            workouts: [
              {
                id: 'program-workout-1',
                title: 'Upper Body',
                exercises: [
                  {
                    id: 'program-exercise-1',
                    exerciseNameSnapshot: 'Bench Press',
                    sets: [
                      {
                        id: 'program-set-1',
                        plannedReps: 10,
                        plannedWeightKg: 60,
                        targetRpe: 8,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };

        repository.findAssignmentDetailsById.mockResolvedValue(details);

        const result = await service.findOneAssignmentDetails(
          'assignment-1',
          athlete,
        );

        expect(repository.findAssignmentDetailsById).toHaveBeenCalledWith(
          'assignment-1',
          {
            athleteId: athlete.id,
          },
        );

        expect(result).toEqual(details);
      });

      it('should hide assignment details belonging to another athlete', async () => {
        repository.findAssignmentDetailsById.mockResolvedValue(null);

        await expect(
          service.findOneAssignmentDetails('assignment-1', athlete),
        ).rejects.toThrow(NotFoundException);
      });

      it('should scope trainer access to owned programs', async () => {
        const details = {
          id: 'assignment-1',
          version: {
            workouts: [],
          },
        };

        repository.findAssignmentDetailsById.mockResolvedValue(details);

        const result = await service.findOneAssignmentDetails(
          'assignment-1',
          trainer,
        );

        expect(repository.findAssignmentDetailsById).toHaveBeenCalledWith(
          'assignment-1',
          {
            AND: [
              {
                version: {
                  program: {
                    trainerId: trainer.id,
                  },
                },
              },
              {
                trainerAthlete: {
                  is: {
                    status: 'ACTIVE',
                  },
                },
              },
            ],
          },
        );

        expect(
          repository.findHistoricalAssignmentDetailsById,
        ).not.toHaveBeenCalled();

        expect(result).toEqual(details);
      });
    });

    it('should hide assignments belonging to another athlete', async () => {
      repository.findAssignmentById.mockResolvedValue(null);

      await expect(
        service.findOneAssignment('assignment-1', athlete),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow an athlete to complete an active assignment', async () => {
      const completed = {
        ...activeAssignment,
        status: 'COMPLETED',
        completedAt: new Date(),
      };

      repository.completeAssignmentIfNoUnfinishedWorkouts.mockResolvedValue({
        status: 'COMPLETED',
        assignment: completed,
      });

      const result = await service.completeAssignment('assignment-1', athlete);

      expect(
        repository.completeAssignmentIfNoUnfinishedWorkouts,
      ).toHaveBeenCalledWith({
        assignmentId: 'assignment-1',
        athleteId: athlete.id,
        completedAt: expect.any(Date),
      });

      expect(repository.updateAssignment).not.toHaveBeenCalled();

      expect(result).toEqual(completed);
    });

    it('should reject assignment completion by a trainer', async () => {
      await expect(
        service.completeAssignment('assignment-1', trainer),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.updateAssignment).not.toHaveBeenCalled();
    });

    it('should allow the owning trainer to cancel an active assignment', async () => {
      repository.updateAssignment.mockResolvedValue({
        ...activeAssignment,
        status: 'CANCELLED',
      });

      await service.cancelAssignment('assignment-1', trainer, {
        reason: 'Program updated',
      });

      expect(repository.updateAssignment).toHaveBeenCalledWith(
        {
          id: 'assignment-1',
          status: 'ACTIVE',
        },
        expect.objectContaining({
          status: 'CANCELLED',
          endedAt: expect.any(Date),
          endedBy: {
            connect: { id: trainer.id },
          },
          endReason: 'Program updated',
        }),
      );
    });

    it('should reject cancellation by an athlete', async () => {
      await expect(
        service.cancelAssignment('assignment-1', athlete),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.updateAssignment).not.toHaveBeenCalled();
    });

    it('should reject completing an already completed assignment', async () => {
      repository.findAssignmentById.mockResolvedValue({
        ...activeAssignment,
        status: 'COMPLETED',
      });

      await expect(
        service.completeAssignment('assignment-1', athlete),
      ).rejects.toThrow(ConflictException);

      expect(repository.updateAssignment).not.toHaveBeenCalled();
    });

    it('should reject cancelling an already cancelled assignment', async () => {
      repository.findAssignmentById.mockResolvedValue({
        ...activeAssignment,
        status: 'CANCELLED',
      });

      await expect(
        service.cancelAssignment('assignment-1', trainer),
      ).rejects.toThrow(ConflictException);

      expect(repository.updateAssignment).not.toHaveBeenCalled();
    });

    it('requests a compact athlete assignment list when asked', async () => {
      repository.findManyAssignments.mockResolvedValue({ data: [], meta: {} });
      await service.findManyAssignments(athlete, {
        page: 1,
        limit: 20,
        view: 'summary',
      });
      expect(repository.findManyAssignments).toHaveBeenCalledWith(
        expect.objectContaining({ view: 'summary', take: 20 }),
      );
    });

    it('should reject invalid assignment pagination', async () => {
      await expect(
        service.findManyAssignments(trainer, {
          page: 0,
          limit: 20,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.findManyAssignments).not.toHaveBeenCalled();
    });

    it('should reject completion when unfinished workouts exist', async () => {
      repository.completeAssignmentIfNoUnfinishedWorkouts.mockResolvedValue({
        status: 'HAS_UNFINISHED_WORKOUTS',
        unfinishedCount: 2,
      });

      await expect(
        service.completeAssignment('assignment-1', athlete),
      ).rejects.toThrow(
        new ConflictException(
          'Cannot complete assignment: 2 unfinished workout(s) remain.',
        ),
      );

      expect(
        repository.completeAssignmentIfNoUnfinishedWorkouts,
      ).toHaveBeenCalledWith({
        assignmentId: 'assignment-1',
        athleteId: athlete.id,
        completedAt: expect.any(Date),
      });

      expect(repository.updateAssignment).not.toHaveBeenCalled();
    });

    it('should reject completion when assignment becomes inactive', async () => {
      repository.completeAssignmentIfNoUnfinishedWorkouts.mockResolvedValue({
        status: 'NOT_ACTIVE',
      });

      await expect(
        service.completeAssignment('assignment-1', athlete),
      ).rejects.toThrow(
        new ConflictException(
          'Assignment state has changed. Reload and try again.',
        ),
      );

      expect(
        repository.completeAssignmentIfNoUnfinishedWorkouts,
      ).toHaveBeenCalledWith({
        assignmentId: 'assignment-1',
        athleteId: athlete.id,
        completedAt: expect.any(Date),
      });

      expect(repository.updateAssignment).not.toHaveBeenCalled();
    });
  });
});
