import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';

import { UsersRepository } from '../users/users.repository.js';
import { TrainerAthletesRepository } from './trainer-athletes.repository.js';

import type { ExerciseAccessContext } from '../exercises/types/exercise.types.js';

import type {
  CreateTrainerAthleteInput,
  TerminateTrainerAthleteInput,
  TrainerAthleteActor,
  TrainerAthleteListQuery,
} from './types/trainer-athlete.types.js';

@Injectable()
export class TrainerAthletesService {
  constructor(
    private readonly trainerAthletesRepository: TrainerAthletesRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  // CREATE REQUEST
  async create(actor: TrainerAthleteActor, input: CreateTrainerAthleteInput) {
    this.assertParticipantRole(actor);

    if (actor.id === input.userId) {
      throw new BadRequestException(
        'You cannot create a relationship with yourself',
      );
    }

    const target = await this.usersRepository.findUserById(input.userId);

    if (!target) {
      throw new NotFoundException('User not found');
    }

    let trainerId: string;
    let athleteId: string;

    if (actor.role === 'TRAINER') {
      if (target.role !== 'ATHLETE') {
        throw new BadRequestException('A trainer can only invite an athlete');
      }

      trainerId = actor.id;
      athleteId = target.id;
    } else {
      if (target.role !== 'TRAINER') {
        throw new BadRequestException('An athlete can only invite a trainer');
      }

      trainerId = target.id;
      athleteId = actor.id;
    }

    const existing = await this.trainerAthletesRepository.findOpenByPair(
      trainerId,
      athleteId,
    );

    if (existing) {
      throw new ConflictException(
        'An active or pending relationship already exists',
      );
    }

    const data = {
      trainer: {
        connect: { id: trainerId },
      },
      athlete: {
        connect: { id: athleteId },
      },
      initiatedBy: {
        connect: { id: actor.id },
      },
    } satisfies Prisma.TrainerAthleteCreateInput;

    try {
      return await this.trainerAthletesRepository.create(data);
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException(
          'An active or pending relationship already exists',
        );
      }

      throw error;
    }
  }

  // FIND MANY
  async findMany(actor: TrainerAthleteActor, query: TrainerAthleteListQuery) {
    this.assertParticipantRole(actor);
    this.validatePagination(query);

    const where: Prisma.TrainerAthleteWhereInput = {
      OR: [{ trainerId: actor.id }, { athleteId: actor.id }],
      ...(query.status ? { status: query.status } : {}),
    };

    const params = {
      where,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    };

    if (actor.role === 'TRAINER') {
      return this.trainerAthletesRepository.findManyForTrainer(params);
    }

    return this.trainerAthletesRepository.findMany(params);
  }

  // FIND ONE

  async findOne(id: string, actor: TrainerAthleteActor) {
    this.assertParticipantRole(actor);

    const accessWhere: Prisma.TrainerAthleteWhereInput = {
      OR: [{ trainerId: actor.id }, { athleteId: actor.id }],
    };

    if (actor.role === 'TRAINER') {
      const openRelationship = await this.trainerAthletesRepository.findById(
        id,
        {
          AND: [
            accessWhere,
            {
              status: {
                in: ['ACTIVE', 'PENDING'],
              },
            },
          ],
        },
      );

      if (openRelationship) {
        return openRelationship;
      }

      const historical =
        await this.trainerAthletesRepository.findHistoricalById(
          id,
          accessWhere,
        );

      if (!historical) {
        throw new NotFoundException('Relationship not found');
      }

      return historical;
    }

    const relationship = await this.trainerAthletesRepository.findById(
      id,
      accessWhere,
    );

    if (!relationship) {
      throw new NotFoundException('Relationship not found');
    }

    return relationship;
  }

  // ACCEPT REQUEST
  async accept(id: string, actor: TrainerAthleteActor) {
    const relationship = await this.findOne(id, actor);

    this.assertRecipient(relationship, actor);
    this.assertStatus(relationship.status, 'PENDING');

    return this.updateWithConflictHandling(
      {
        id,
        status: 'PENDING',
      },
      {
        status: 'ACTIVE',
        respondedAt: new Date(),
      },
    );
  }

  // DECLINE REQUEST
  async decline(id: string, actor: TrainerAthleteActor) {
    const relationship = await this.findOne(id, actor);

    this.assertRecipient(relationship, actor);
    this.assertStatus(relationship.status, 'PENDING');

    return this.updateWithConflictHandling(
      {
        id,
        status: 'PENDING',
      },
      {
        status: 'DECLINED',
        respondedAt: new Date(),
      },
      actor.role === 'TRAINER',
    );
  }

  // CANCEL REQUEST
  async cancel(
    id: string,
    actor: TrainerAthleteActor,
    input: TerminateTrainerAthleteInput = {},
  ) {
    const relationship = await this.findOne(id, actor);

    if (relationship.initiatedById !== actor.id) {
      throw new ForbiddenException('Only the request initiator can cancel it');
    }

    this.assertStatus(relationship.status, 'PENDING');

    return this.updateWithConflictHandling(
      {
        id,
        status: 'PENDING',
      },
      {
        status: 'CANCELLED',
        endedAt: new Date(),
        endedBy: {
          connect: { id: actor.id },
        },
        endReason: input.reason ?? null,
      },
      actor.role === 'TRAINER',
    );
  }

  // TERMINATE ACTIVE RELATIONSHIP
  async terminate(
    id: string,
    actor: TrainerAthleteActor,
    input: TerminateTrainerAthleteInput,
  ) {
    const relationship = await this.findOne(id, actor);

    this.assertStatus(relationship.status, 'ACTIVE');

    const terminated =
      await this.trainerAthletesRepository.terminateWithExerciseCopies({
        id,
        actorId: actor.id,
        reason: input.reason,
        redactForTrainer: actor.role === 'TRAINER',
      });

    if (!terminated) {
      throw new ConflictException(
        'Relationship state has changed. Reload and try again.',
      );
    }

    return terminated;
  }

  // EXERCISE ACCESS CONTEXT
  async getExerciseAccessContext(
    actor: TrainerAthleteActor,
  ): Promise<ExerciseAccessContext> {
    if (actor.role === 'ATHLETE') {
      const activeTrainerIds =
        await this.trainerAthletesRepository.findActiveTrainerIdsForAthlete(
          actor.id,
        );

      return {
        activeTrainerIds,
        activeAthleteIds: [],
      };
    }

    if (actor.role === 'TRAINER') {
      const activeAthleteIds =
        await this.trainerAthletesRepository.findActiveAthleteIdsForTrainer(
          actor.id,
        );

      return {
        activeTrainerIds: [],
        activeAthleteIds,
      };
    }

    return {
      activeTrainerIds: [],
      activeAthleteIds: [],
    };
  }

  // HELPERS
  private assertParticipantRole(actor: TrainerAthleteActor): void {
    if (actor.role !== 'ATHLETE' && actor.role !== 'TRAINER') {
      throw new ForbiddenException(
        'Only trainers and athletes can manage relationships',
      );
    }
  }

  private assertRecipient(
    relationship: {
      initiatedById: string;
    },
    actor: TrainerAthleteActor,
  ): void {
    if (relationship.initiatedById === actor.id) {
      throw new ForbiddenException(
        'The request initiator cannot respond to their own request',
      );
    }
  }

  private assertStatus(currentStatus: string, expectedStatus: string): void {
    if (currentStatus !== expectedStatus) {
      throw new ConflictException(
        `Relationship must be ${expectedStatus.toLowerCase()}`,
      );
    }
  }

  private validatePagination(query: TrainerAthleteListQuery): void {
    if (
      !Number.isInteger(query.page) ||
      query.page < 1 ||
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      throw new BadRequestException('Invalid pagination parameters');
    }
  }

  private async updateWithConflictHandling(
    where: Prisma.TrainerAthleteWhereUniqueInput,
    data: Prisma.TrainerAthleteUpdateInput,
    redactForTrainer = false,
  ) {
    try {
      return await this.trainerAthletesRepository.update(
        where,
        data,
        redactForTrainer,
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException(
          'Relationship state has changed. Reload and try again.',
        );
      }

      throw error;
    }
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
