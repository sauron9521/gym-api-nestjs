import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { TrainingProgramsRepository } from '../training-programs.repository.js';
import { TrainingProgramsService } from '../training-programs.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

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
    createAssignment: vi.fn(),
  };

  const exercisesServiceMock = {
    findOne: vi.fn(),
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

    service = new TrainingProgramsService(
      repository as unknown as TrainingProgramsRepository,
      exercisesServiceMock as unknown as ExercisesService,
      trainerAthletesServiceMock as unknown as TrainerAthletesService,
    );
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

      repository.createAssignment.mockResolvedValue(assignment);

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

      expect(repository.createAssignment).toHaveBeenCalledWith({
        version: {
          connect: { id: 'version-1' },
        },
        trainerAthlete: {
          connect: { id: relationship.id },
        },
        athlete: {
          connect: { id: relationship.athleteId },
        },
        assignedBy: {
          connect: { id: trainer.id },
        },
      });

      expect(result).toEqual(assignment);
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

      expect(repository.createAssignment).not.toHaveBeenCalled();
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

      expect(repository.createAssignment).not.toHaveBeenCalled();
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

      expect(repository.createAssignment).not.toHaveBeenCalled();
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

      expect(repository.createAssignment).not.toHaveBeenCalled();
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

      expect(repository.createAssignment).not.toHaveBeenCalled();
    });

    it('should convert duplicate assignment conflict into ConflictException', async () => {
      repository.createAssignment.mockRejectedValue(
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
});
