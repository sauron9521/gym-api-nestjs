import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';

import { UsersRepository } from '../../users/users.repository.js';
import { TrainerAthletesRepository } from '../trainer-athletes.repository.js';
import { TrainerAthletesService } from '../trainer-athletes.service.js';

import type { TrainerAthleteActor } from '../types/trainer-athlete.types.js';

describe('TrainerAthletesService', () => {
  let service: TrainerAthletesService;

  const repository = {
    create: vi.fn(),
    findMany: vi.fn(),
    findById: vi.fn(),
    findOpenByPair: vi.fn(),
    update: vi.fn(),
    findActiveTrainerIdsForAthlete: vi.fn(),
    findActiveAthleteIdsForTrainer: vi.fn(),
    terminateWithExerciseCopies: vi.fn(),
  };

  const usersRepository = {
    findUserById: vi.fn(),
  };

  const trainer: TrainerAthleteActor = {
    id: 'trainer-1',
    role: 'TRAINER',
  };

  const athlete: TrainerAthleteActor = {
    id: 'athlete-1',
    role: 'ATHLETE',
  };

  const admin: TrainerAthleteActor = {
    id: 'admin-1',
    role: 'ADMIN',
  };

  const trainerUser = {
    id: trainer.id,
    email: 'trainer@example.com',
    role: 'TRAINER',
  };

  const athleteUser = {
    id: athlete.id,
    email: 'athlete@example.com',
    role: 'ATHLETE',
  };

  const pendingRelationship = {
    id: 'relationship-1',
    trainerId: trainer.id,
    athleteId: athlete.id,
    initiatedById: trainer.id,
    status: 'PENDING',
  };

  const activeRelationship = {
    ...pendingRelationship,
    status: 'ACTIVE',
  };

  beforeEach(() => {
    vi.resetAllMocks();

    service = new TrainerAthletesService(
      repository as unknown as TrainerAthletesRepository,
      usersRepository as unknown as UsersRepository,
    );
  });

  describe('create', () => {
    it('should allow a trainer to invite an athlete', async () => {
      usersRepository.findUserById.mockResolvedValue(athleteUser);
      repository.findOpenByPair.mockResolvedValue(null);
      repository.create.mockResolvedValue(pendingRelationship);

      const result = await service.create(trainer, {
        userId: athlete.id,
      });

      expect(result).toEqual(pendingRelationship);

      expect(repository.findOpenByPair).toHaveBeenCalledWith(
        trainer.id,
        athlete.id,
      );

      expect(repository.create).toHaveBeenCalledWith({
        trainer: {
          connect: { id: trainer.id },
        },
        athlete: {
          connect: { id: athlete.id },
        },
        initiatedBy: {
          connect: { id: trainer.id },
        },
      });
    });

    it('should allow an athlete to invite a trainer', async () => {
      usersRepository.findUserById.mockResolvedValue(trainerUser);
      repository.findOpenByPair.mockResolvedValue(null);
      repository.create.mockResolvedValue({
        ...pendingRelationship,
        initiatedById: athlete.id,
      });

      await service.create(athlete, {
        userId: trainer.id,
      });

      expect(repository.create).toHaveBeenCalledWith({
        trainer: {
          connect: { id: trainer.id },
        },
        athlete: {
          connect: { id: athlete.id },
        },
        initiatedBy: {
          connect: { id: athlete.id },
        },
      });
    });

    it('should reject creating a relationship with yourself', async () => {
      await expect(
        service.create(trainer, { userId: trainer.id }),
      ).rejects.toThrow(BadRequestException);

      expect(usersRepository.findUserById).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should reject a missing target user', async () => {
      usersRepository.findUserById.mockResolvedValue(null);

      await expect(
        service.create(trainer, { userId: athlete.id }),
      ).rejects.toThrow(NotFoundException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should reject a trainer inviting another trainer', async () => {
      usersRepository.findUserById.mockResolvedValue(trainerUser);

      await expect(
        service.create(trainer, { userId: trainer.id + '-2' }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.findOpenByPair).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should reject an athlete inviting another athlete', async () => {
      usersRepository.findUserById.mockResolvedValue(athleteUser);

      await expect(
        service.create(athlete, { userId: athlete.id + '-2' }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should reject users with unsupported roles', async () => {
      await expect(
        service.create(admin, { userId: athlete.id }),
      ).rejects.toThrow(ForbiddenException);

      expect(usersRepository.findUserById).not.toHaveBeenCalled();
    });

    it('should reject an existing pending or active relationship', async () => {
      usersRepository.findUserById.mockResolvedValue(athleteUser);
      repository.findOpenByPair.mockResolvedValue({
        id: 'relationship-existing',
        status: 'ACTIVE',
      });

      await expect(
        service.create(trainer, { userId: athlete.id }),
      ).rejects.toThrow(ConflictException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should handle a concurrent duplicate request', async () => {
      usersRepository.findUserById.mockResolvedValue(athleteUser);
      repository.findOpenByPair.mockResolvedValue(null);

      repository.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.10.1',
        }),
      );

      await expect(
        service.create(trainer, { userId: athlete.id }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findMany', () => {
    it('should return relationships for the current trainer', async () => {
      const response = {
        data: [pendingRelationship],
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
        status: 'PENDING',
      });

      expect(result).toEqual(response);

      expect(repository.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ trainerId: trainer.id }, { athleteId: trainer.id }],
          status: 'PENDING',
        },
        skip: 0,
        take: 20,
      });
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
    it('should return a relationship for its participant', async () => {
      repository.findById.mockResolvedValue(pendingRelationship);

      const result = await service.findOne(pendingRelationship.id, trainer);

      expect(result).toEqual(pendingRelationship);

      expect(repository.findById).toHaveBeenCalledWith(pendingRelationship.id, {
        OR: [{ trainerId: trainer.id }, { athleteId: trainer.id }],
      });
    });

    it('should hide relationships from unrelated users', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.findOne('relationship-1', {
          id: 'another-user',
          role: 'ATHLETE',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('accept', () => {
    it('should allow the recipient to accept a request', async () => {
      repository.findById.mockResolvedValue(pendingRelationship);
      repository.update.mockResolvedValue(activeRelationship);

      const result = await service.accept(pendingRelationship.id, athlete);

      expect(result).toEqual(activeRelationship);

      expect(repository.update).toHaveBeenCalledWith(
        {
          id: pendingRelationship.id,
          status: 'PENDING',
        },
        expect.objectContaining({
          status: 'ACTIVE',
          respondedAt: expect.any(Date),
        }),
      );
    });

    it('should reject acceptance by the initiator', async () => {
      repository.findById.mockResolvedValue(pendingRelationship);

      await expect(
        service.accept(pendingRelationship.id, trainer),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should reject accepting a non-pending relationship', async () => {
      repository.findById.mockResolvedValue(activeRelationship);

      await expect(
        service.accept(activeRelationship.id, athlete),
      ).rejects.toThrow(ConflictException);

      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('decline', () => {
    it('should allow the recipient to decline a request', async () => {
      repository.findById.mockResolvedValue(pendingRelationship);

      repository.update.mockResolvedValue({
        ...pendingRelationship,
        status: 'DECLINED',
      });

      const result = await service.decline(pendingRelationship.id, athlete);

      expect(result.status).toBe('DECLINED');

      expect(repository.update).toHaveBeenCalledWith(
        {
          id: pendingRelationship.id,
          status: 'PENDING',
        },
        expect.objectContaining({
          status: 'DECLINED',
          respondedAt: expect.any(Date),
        }),
      );
    });

    it('should reject decline by the initiator', async () => {
      repository.findById.mockResolvedValue(pendingRelationship);

      await expect(
        service.decline(pendingRelationship.id, trainer),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should allow the initiator to cancel a pending request', async () => {
      repository.findById.mockResolvedValue(pendingRelationship);

      repository.update.mockResolvedValue({
        ...pendingRelationship,
        status: 'CANCELLED',
      });

      const result = await service.cancel(pendingRelationship.id, trainer, {
        reason: 'Changed my plans',
      });

      expect(result.status).toBe('CANCELLED');

      expect(repository.update).toHaveBeenCalledWith(
        {
          id: pendingRelationship.id,
          status: 'PENDING',
        },
        expect.objectContaining({
          status: 'CANCELLED',
          endedAt: expect.any(Date),
          endedBy: {
            connect: { id: trainer.id },
          },
          endReason: 'Changed my plans',
        }),
      );
    });

    it('should reject cancellation by the recipient', async () => {
      repository.findById.mockResolvedValue(pendingRelationship);

      await expect(
        service.cancel(pendingRelationship.id, athlete),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('terminate', () => {
    it('should allow a trainer to terminate an active relationship', async () => {
      repository.findById.mockResolvedValue({
        id: 'relationship-1',
        trainerId: trainer.id,
        athleteId: 'athlete-1',
        initiatedById: trainer.id,
        status: 'ACTIVE',
      });

      repository.terminateWithExerciseCopies.mockResolvedValue({
        id: 'relationship-1',
        status: 'TERMINATED',
      });

      const result = await service.terminate('relationship-1', trainer, {
        reason: 'Cooperation ended',
      });

      expect(result.status).toBe('TERMINATED');

      expect(repository.terminateWithExerciseCopies).toHaveBeenCalledWith({
        id: 'relationship-1',
        actorId: trainer.id,
        reason: 'Cooperation ended',
      });
    });

    it('should allow an athlete to terminate an active relationship', async () => {
      repository.findById.mockResolvedValue({
        id: 'relationship-1',
        trainerId: trainer.id,
        athleteId: athlete.id,
        initiatedById: trainer.id,
        status: 'ACTIVE',
      });

      repository.terminateWithExerciseCopies.mockResolvedValue({
        id: 'relationship-1',
        status: 'TERMINATED',
      });

      const result = await service.terminate('relationship-1', athlete, {
        reason: 'Cooperation ended by athlete',
      });

      expect(result.status).toBe('TERMINATED');

      expect(repository.terminateWithExerciseCopies).toHaveBeenCalledWith({
        id: 'relationship-1',
        actorId: athlete.id,
        reason: 'Cooperation ended by athlete',
      });
    });

    it('should reject terminating a pending relationship', async () => {
      repository.findById.mockResolvedValue(pendingRelationship);

      await expect(
        service.terminate(pendingRelationship.id, trainer, {}),
      ).rejects.toThrow(ConflictException);

      expect(repository.terminateWithExerciseCopies).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('getExerciseAccessContext', () => {
    it('should return active trainer IDs for an athlete', async () => {
      repository.findActiveTrainerIdsForAthlete.mockResolvedValue([
        'trainer-1',
        'trainer-2',
      ]);

      const result = await service.getExerciseAccessContext(athlete);

      expect(result).toEqual({
        activeTrainerIds: ['trainer-1', 'trainer-2'],
        activeAthleteIds: [],
      });
    });

    it('should return active athlete IDs for a trainer', async () => {
      repository.findActiveAthleteIdsForTrainer.mockResolvedValue([
        'athlete-1',
        'athlete-2',
      ]);

      const result = await service.getExerciseAccessContext(trainer);

      expect(result).toEqual({
        activeTrainerIds: [],
        activeAthleteIds: ['athlete-1', 'athlete-2'],
      });
    });

    it('should return an empty context for an admin', async () => {
      const result = await service.getExerciseAccessContext(admin);

      expect(result).toEqual({
        activeTrainerIds: [],
        activeAthleteIds: [],
      });

      expect(repository.findActiveTrainerIdsForAthlete).not.toHaveBeenCalled();

      expect(repository.findActiveAthleteIdsForTrainer).not.toHaveBeenCalled();
    });
  });

  describe('concurrent updates', () => {
    it('should convert Prisma P2025 into ConflictException', async () => {
      repository.findById.mockResolvedValue(pendingRelationship);

      repository.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '7.10.1',
        }),
      );

      await expect(
        service.accept(pendingRelationship.id, athlete),
      ).rejects.toThrow(ConflictException);
    });
  });
});
