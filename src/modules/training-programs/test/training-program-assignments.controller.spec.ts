import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { TrainingProgramsController } from '../training-programs.controller.js';
import { TrainingProgramsModule } from '../training-programs.module.js';
import { TrainingProgramAssignmentsController } from '../training-program-assignments.controller.js';
import { TrainingProgramsService } from '../services/training-programs.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

describe('TrainingProgramAssignmentsController', () => {
  const service = {
    findManyAssignments: vi.fn(),
    findOneAssignmentDetails: vi.fn(),
    completeAssignment: vi.fn(),
    cancelAssignment: vi.fn(),
    assignVersionToAthlete: vi.fn(),
  };

  let controller: TrainingProgramAssignmentsController;

  const actor: TrainingProgramActor = {
    id: 'trainer-1',
    role: 'TRAINER',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new TrainingProgramAssignmentsController(
      service as unknown as TrainingProgramsService,
    );
  });

  it('should return assignments for current user', async () => {
    const query = {
      page: 1,
      limit: 20,
      status: 'ACTIVE' as const,
    };

    service.findManyAssignments.mockResolvedValue({
      data: [],
      meta: {},
    });

    await controller.findManyAssignments(actor, query);

    expect(service.findManyAssignments).toHaveBeenCalledWith(actor, query);
  });

  it('passes a summary view to the assignment service', async () => {
    const query = { page: 1, limit: 20, view: 'summary' as const };
    service.findManyAssignments.mockResolvedValue({ data: [], meta: {} });
    await controller.findManyAssignments(actor, query);
    expect(service.findManyAssignments).toHaveBeenCalledWith(actor, query);
  });

  it('should return one assignment with full program details', async () => {
    const details = {
      id: 'assignment-1',
      version: {
        id: 'version-1',
        workouts: [],
      },
    };

    service.findOneAssignmentDetails.mockResolvedValue(details);

    const result = await controller.findOneAssignment('assignment-1', actor);

    expect(service.findOneAssignmentDetails).toHaveBeenCalledWith(
      'assignment-1',
      actor,
    );

    expect(result).toEqual(details);
  });

  it('should complete an assignment', async () => {
    service.completeAssignment.mockResolvedValue({
      id: 'assignment-1',
      status: 'COMPLETED',
    });

    await controller.completeAssignment('assignment-1', actor);

    expect(service.completeAssignment).toHaveBeenCalledWith(
      'assignment-1',
      actor,
    );
  });

  it('should cancel an assignment', async () => {
    const body = {
      reason: 'Program changed',
    };

    service.cancelAssignment.mockResolvedValue({
      id: 'assignment-1',
      status: 'CANCELLED',
    });

    await controller.cancelAssignment('assignment-1', actor, body);

    expect(service.cancelAssignment).toHaveBeenCalledWith(
      'assignment-1',
      actor,
      body,
    );
  });

  it('should assign a published version to an athlete', async () => {
    const body = {
      trainerAthleteId: 'relationship-1',
    };

    service.assignVersionToAthlete.mockResolvedValue({
      id: 'assignment-1',
      status: 'ACTIVE',
    });

    await controller.assignVersionToAthlete(
      'program-1',
      'version-1',
      actor,
      body,
    );

    expect(service.assignVersionToAthlete).toHaveBeenCalledWith(
      actor,
      'program-1',
      'version-1',
      body,
    );
  });
  it('registers literal assignment routes before dynamic program routes', () => {
    const controllers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      TrainingProgramsModule,
    );
    expect(controllers.indexOf(TrainingProgramAssignmentsController))
      .toBeLessThan(controllers.indexOf(TrainingProgramsController));
    expect(Reflect.getMetadata(PATH_METADATA, TrainingProgramAssignmentsController))
      .toBe('training-programs');
  });

  it.each([
    ['findManyAssignments', 'assignments', RequestMethod.GET],
    ['findOneAssignment', 'assignments/:assignmentId', RequestMethod.GET],
    ['completeAssignment', 'assignments/:assignmentId/complete', RequestMethod.POST],
    ['cancelAssignment', 'assignments/:assignmentId/cancel', RequestMethod.POST],
    ['assignVersionToAthlete', ':programId/versions/:versionId/assignments', RequestMethod.POST],
  ] as const)('preserves the HTTP route for %s', (handler, path, method) => {
    const action = TrainingProgramAssignmentsController.prototype[handler];
    expect(Reflect.getMetadata(PATH_METADATA, action)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, action)).toBe(method);
  });

});
