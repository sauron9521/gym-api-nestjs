import { Test, TestingModule } from '@nestjs/testing';

import { TrainerAthletesController } from '../trainer-athletes.controller.js';
import { TrainerAthletesService } from '../trainer-athletes.service.js';

import type { TrainerAthleteActor } from '../types/trainer-athlete.types.js';
import type { CreateTrainerAthleteDto } from '../dto/create-trainer-athlete.dto.js';
import type { QueryTrainerAthletesDto } from '../dto/query-trainer-athletes.dto.js';
import type { TerminateTrainerAthleteDto } from '../dto/terminate-trainer-athlete.dto.js';

describe('TrainerAthletesController', () => {
  let controller: TrainerAthletesController;

  const trainerAthletesService = {
    create: vi.fn(),
    findMany: vi.fn(),
    findOne: vi.fn(),
    accept: vi.fn(),
    decline: vi.fn(),
    cancel: vi.fn(),
    terminate: vi.fn(),
  };

  const trainer: TrainerAthleteActor = {
    id: 'trainer-1',
    role: 'TRAINER',
  };

  const athlete: TrainerAthleteActor = {
    id: 'athlete-1',
    role: 'ATHLETE',
  };

  beforeEach(async () => {
    vi.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrainerAthletesController],
      providers: [
        {
          provide: TrainerAthletesService,
          useValue: trainerAthletesService,
        },
      ],
    }).compile();

    controller = module.get<TrainerAthletesController>(
      TrainerAthletesController,
    );
  });

  describe('create', () => {
    it('should pass the authenticated trainer and DTO to the service', async () => {
      const body: CreateTrainerAthleteDto = {
        userId: 'athlete-1',
      };

      const relationship = {
        id: 'relationship-1',
        trainerId: trainer.id,
        athleteId: athlete.id,
        initiatedById: trainer.id,
        status: 'PENDING',
      };

      trainerAthletesService.create.mockResolvedValue(relationship);

      const result = await controller.create(trainer, body);

      expect(trainerAthletesService.create).toHaveBeenCalledWith(trainer, body);
      expect(result).toEqual(relationship);
    });

    it('should support a request initiated by an athlete', async () => {
      const body: CreateTrainerAthleteDto = {
        userId: trainer.id,
      };

      trainerAthletesService.create.mockResolvedValue({
        id: 'relationship-1',
        status: 'PENDING',
      });

      await controller.create(athlete, body);

      expect(trainerAthletesService.create).toHaveBeenCalledWith(athlete, body);
    });

    it('should propagate service errors', async () => {
      const error = new Error('Relationship creation failed');

      trainerAthletesService.create.mockRejectedValue(error);

      await expect(
        controller.create(trainer, { userId: athlete.id }),
      ).rejects.toBe(error);
    });
  });

  describe('findMany', () => {
    it('should pass the authenticated user and query to the service', async () => {
      const query: QueryTrainerAthletesDto = {
        page: 2,
        limit: 10,
        status: 'ACTIVE',
      };

      const response = {
        data: [{ id: 'relationship-1', status: 'ACTIVE' }],
        meta: {
          total: 1,
          page: 2,
          limit: 10,
          totalPages: 1,
        },
      };

      trainerAthletesService.findMany.mockResolvedValue(response);

      const result = await controller.findMany(trainer, query);

      expect(trainerAthletesService.findMany).toHaveBeenCalledWith(
        trainer,
        query,
      );
      expect(result).toEqual(response);
    });
  });

  describe('findOne', () => {
    it('should pass relationship ID and authenticated user to the service', async () => {
      const relationship = {
        id: 'relationship-1',
        status: 'ACTIVE',
      };

      trainerAthletesService.findOne.mockResolvedValue(relationship);

      const result = await controller.findOne('relationship-1', athlete);

      expect(trainerAthletesService.findOne).toHaveBeenCalledWith(
        'relationship-1',
        athlete,
      );
      expect(result).toEqual(relationship);
    });
  });

  describe('accept', () => {
    it('should accept a relationship request', async () => {
      const relationship = {
        id: 'relationship-1',
        status: 'ACTIVE',
      };

      trainerAthletesService.accept.mockResolvedValue(relationship);

      const result = await controller.accept('relationship-1', athlete);

      expect(trainerAthletesService.accept).toHaveBeenCalledWith(
        'relationship-1',
        athlete,
      );
      expect(result).toEqual(relationship);
    });
  });

  describe('decline', () => {
    it('should decline a relationship request', async () => {
      const relationship = {
        id: 'relationship-1',
        status: 'DECLINED',
      };

      trainerAthletesService.decline.mockResolvedValue(relationship);

      const result = await controller.decline('relationship-1', athlete);

      expect(trainerAthletesService.decline).toHaveBeenCalledWith(
        'relationship-1',
        athlete,
      );
      expect(result).toEqual(relationship);
    });
  });

  describe('cancel', () => {
    it('should cancel a pending request with a reason', async () => {
      const body: TerminateTrainerAthleteDto = {
        reason: 'Request cancelled by initiator',
      };

      const relationship = {
        id: 'relationship-1',
        status: 'CANCELLED',
      };

      trainerAthletesService.cancel.mockResolvedValue(relationship);

      const result = await controller.cancel('relationship-1', trainer, body);

      expect(trainerAthletesService.cancel).toHaveBeenCalledWith(
        'relationship-1',
        trainer,
        body,
      );
      expect(result).toEqual(relationship);
    });

    it('should support cancellation without a body', async () => {
      trainerAthletesService.cancel.mockResolvedValue({
        id: 'relationship-1',
        status: 'CANCELLED',
      });

      await controller.cancel('relationship-1', trainer, undefined);

      expect(trainerAthletesService.cancel).toHaveBeenCalledWith(
        'relationship-1',
        trainer,
        {},
      );
    });
  });

  describe('terminate', () => {
    it('should terminate an active relationship with a reason', async () => {
      const body: TerminateTrainerAthleteDto = {
        reason: 'Cooperation ended',
      };

      const relationship = {
        id: 'relationship-1',
        status: 'TERMINATED',
      };

      trainerAthletesService.terminate.mockResolvedValue(relationship);

      const result = await controller.terminate(
        'relationship-1',
        athlete,
        body,
      );

      expect(trainerAthletesService.terminate).toHaveBeenCalledWith(
        'relationship-1',
        athlete,
        body,
      );
      expect(result).toEqual(relationship);
    });

    it('should support termination without a body', async () => {
      trainerAthletesService.terminate.mockResolvedValue({
        id: 'relationship-1',
        status: 'TERMINATED',
      });

      await controller.terminate('relationship-1', trainer, undefined);

      expect(trainerAthletesService.terminate).toHaveBeenCalledWith(
        'relationship-1',
        trainer,
        {},
      );
    });
  });
});
