import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '#prisma/client';

import { TrainerAthletesService } from '#src/modules/trainer-athletes/trainer-athletes.service';

import { TrainingProgramAssignmentRepository } from '../repositories/training-program-assignment.repository.js';
import { TrainingProgramAccessService } from './training-program-access.service.js';
import { TrainingProgramCrudService } from './training-program-crud.service.js';
import { TrainingProgramVersionService } from './training-program-version.service.js';

import type {
  CancelTrainingProgramAssignmentInput,
  CreateTrainingProgramAssignmentInput,
  TrainingProgramActor,
  TrainingProgramAssignmentListQuery,
} from '../types/training-program.types.js';

@Injectable()
export class TrainingProgramAssignmentService {
  constructor(
    private readonly repository: TrainingProgramAssignmentRepository,
    private readonly crudService: TrainingProgramCrudService,
    private readonly versionService: TrainingProgramVersionService,
    private readonly accessService: TrainingProgramAccessService,
    private readonly trainerAthletesService: TrainerAthletesService,
  ) {}

  async assignVersionToAthlete(
    actor: TrainingProgramActor,
    programId: string,
    versionId: string,
    input: CreateTrainingProgramAssignmentInput,
  ) {
    this.accessService.assertTrainer(actor);

    const program = await this.crudService.findOne(programId, actor);

    if (program.status === 'ARCHIVED') {
      throw new ConflictException('Archived programs cannot be assigned.');
    }

    const version = await this.versionService.findVersion(
      programId,
      versionId,
      actor,
    );

    if (version.status !== 'PUBLISHED') {
      throw new ConflictException('Only published versions can be assigned.');
    }

    const relationship = await this.trainerAthletesService.findOne(
      input.trainerAthleteId,
      actor,
    );

    if (relationship.trainerId !== actor.id) {
      throw new ForbiddenException(
        'You can only assign programs to your own athletes.',
      );
    }

    if (relationship.status !== 'ACTIVE') {
      throw new ConflictException(
        'An active trainer-athlete relationship is required.',
      );
    }


    let assignment: Awaited<
      ReturnType<
        TrainingProgramAssignmentRepository['createAssignmentForActiveRelationship']
      >
    >;

    try {
      assignment = await this.repository.createAssignmentForActiveRelationship({
        programId,
        versionId,
        trainerAthleteId: relationship.id,
        trainerId: actor.id,
        athleteId: relationship.athleteId,
      });
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException('This program assignment already exists.');
      }

      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException(
          'The program or relationship state has changed.',
        );
      }

      if (this.isPrismaError(error, 'P2003')) {
        throw new NotFoundException(
          'One of the assignment references no longer exists.',
        );
      }

      throw error;
    }

    if (!assignment) {
      throw new ConflictException(
        'Program, version or trainer-athlete relationship is no longer eligible for assignment. Reload and try again.',
      );
    }

    return assignment;
  }

  async findManyAssignments(
    actor: TrainingProgramActor,
    query: TrainingProgramAssignmentListQuery,
  ) {
    this.assertAssignmentParticipant(actor);
    this.validateAssignmentPagination(query);

    const accessWhere = this.getAssignmentAccessWhere(actor);

    const params = {
      where: {
        AND: [accessWhere, ...(query.status ? [{ status: query.status }] : [])],
      },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      ...(query.view === 'summary' ? { view: 'summary' as const } : {}),
    } satisfies Parameters<
      TrainingProgramAssignmentRepository['findManyAssignments']
    >[0];

    if (actor.role === 'TRAINER') {
      return this.repository.findManyAssignmentsForTrainer(params);
    }

    // Athletes retain full access to their own history.
    return this.repository.findManyAssignments(params);
  }

  async findOneAssignment(assignmentId: string, actor: TrainingProgramActor) {
    this.assertAssignmentParticipant(actor);

    const assignment = await this.repository.findAssignmentById(
      assignmentId,
      this.getAssignmentAccessWhere(actor),
    );

    if (!assignment) {
      throw new NotFoundException('Training program assignment not found.');
    }

    return assignment;
  }

  async findOneAssignmentDetails(
    assignmentId: string,
    actor: TrainingProgramActor,
  ) {
    this.assertAssignmentParticipant(actor);

    const accessWhere = this.getAssignmentAccessWhere(actor);

    if (actor.role === 'TRAINER') {
      // Full details only while collaboration is active.
      const activeAssignment = await this.repository.findAssignmentDetailsById(
        assignmentId,
        {
          AND: [
            accessWhere,
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

      if (activeAssignment) {
        return activeAssignment;
      }

      // Historical access excludes sensitive fields.
      const historicalAssignment =
        await this.repository.findHistoricalAssignmentDetailsById(
          assignmentId,
          accessWhere,
        );

      if (!historicalAssignment) {
        throw new NotFoundException('Training program assignment not found.');
      }

      return historicalAssignment;
    }

    // Athletes can access their own complete history.
    const assignment = await this.repository.findAssignmentDetailsById(
      assignmentId,
      accessWhere,
    );

    if (!assignment) {
      throw new NotFoundException('Training program assignment not found.');
    }

    return assignment;
  }

  async completeAssignment(assignmentId: string, actor: TrainingProgramActor) {
    if (actor.role !== 'ATHLETE') {
      throw new ForbiddenException(
        'Only athletes can complete their program assignments.',
      );
    }

    const assignment = await this.findOneAssignment(assignmentId, actor);

    if (assignment.status !== 'ACTIVE') {
      throw new ConflictException('Only active assignments can be completed.');
    }

    const result =
      await this.repository.completeAssignmentIfNoUnfinishedWorkouts({
        assignmentId,
        athleteId: actor.id,
        completedAt: new Date(),
      });

    switch (result.status) {
      case 'COMPLETED':
        return result.assignment;

      case 'HAS_UNFINISHED_WORKOUTS':
        throw new ConflictException(
          `Cannot complete assignment: ${result.unfinishedCount} unfinished workout(s) remain.`,
        );

      case 'NOT_ACTIVE':
        throw new ConflictException(
          'Assignment state has changed. Reload and try again.',
        );
    }
  }

  async cancelAssignment(
    assignmentId: string,
    actor: TrainingProgramActor,
    input: CancelTrainingProgramAssignmentInput = {},
  ) {
    if (actor.role !== 'TRAINER') {
      throw new ForbiddenException(
        'Only trainers can cancel program assignments.',
      );
    }

    const assignment = await this.findOneAssignment(assignmentId, actor);

    if (assignment.status !== 'ACTIVE') {
      throw new ConflictException('Only active assignments can be cancelled.');
    }

    try {
      return await this.repository.updateAssignment(
        {
          id: assignmentId,
          status: 'ACTIVE',
        },
        {
          status: 'CANCELLED',
          endedAt: new Date(),
          endedBy: {
            connect: { id: actor.id },
          },
          endReason: input.reason?.trim() || null,
        },
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new ConflictException(
          'Assignment state has changed. Reload and try again.',
        );
      }

      throw error;
    }
  }

  private assertAssignmentParticipant(actor: TrainingProgramActor): void {
    if (actor.role !== 'TRAINER' && actor.role !== 'ATHLETE') {
      throw new ForbiddenException(
        'Only trainers and athletes can access program assignments.',
      );
    }
  }

  private getAssignmentAccessWhere(
    actor: TrainingProgramActor,
  ): Prisma.TrainingProgramAssignmentWhereInput {
    if (actor.role === 'TRAINER') {
      return {
        version: {
          program: {
            trainerId: actor.id,
          },
        },
      };
    }

    if (actor.role === 'ATHLETE') {
      return {
        athleteId: actor.id,
      };
    }

    throw new ForbiddenException();
  }

  private validateAssignmentPagination(
    query: TrainingProgramAssignmentListQuery,
  ): void {
    if (
      !Number.isInteger(query.page) ||
      query.page < 1 ||
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      throw new BadRequestException('Invalid pagination parameters.');
    }
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
