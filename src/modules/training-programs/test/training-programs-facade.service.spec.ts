import { ConflictException } from '@nestjs/common';
import { TrainingProgramsService } from '../services/training-programs.service.js';

describe('TrainingProgramsService facade delegation', () => {
  const crud = {
    create: vi.fn(),
    findMany: vi.fn(),
    findOne: vi.fn(),
    archive: vi.fn(),
  };
  const version = {
    findVersions: vi.fn(),
    findVersion: vi.fn(),
    createNextDraft: vi.fn(),
    updateDraftVersion: vi.fn(),
    publishVersion: vi.fn(),
  };
  const assignment = {
    assignVersionToAthlete: vi.fn(),
    findManyAssignments: vi.fn(),
    findOneAssignment: vi.fn(),
    findOneAssignmentDetails: vi.fn(),
    completeAssignment: vi.fn(),
    cancelAssignment: vi.fn(),
  };
  const workout = {
    createWorkout: vi.fn(),
    updateWorkout: vi.fn(),
    deleteWorkout: vi.fn(),
  };
  const exercise = {
    addExercise: vi.fn(),
    updateExercise: vi.fn(),
    removeExercise: vi.fn(),
    reorderExercises: vi.fn(),
  };
  const sets = {
    addSet: vi.fn(),
    updateSet: vi.fn(),
    removeSet: vi.fn(),
    reorderSets: vi.fn(),
  };

  const actor = { id: 'trainer-1', role: 'TRAINER' } as const;
  const programId = 'program-1';
  const versionId = 'version-1';
  const workoutId = 'workout-1';
  const programExerciseId = 'program-exercise-1';
  const setId = 'set-1';
  const assignmentId = 'assignment-1';
  const query = { page: 1, limit: 10 };
  const programInput = { title: 'Strength' };
  const workoutInput = { weekNumber: 1, dayNumber: 1, title: 'Push' };
  const setInput = { plannedReps: 10, plannedWeightKg: 65.5 };

  let service: TrainingProgramsService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new TrainingProgramsService(
      crud as never,
      version as never,
      assignment as never,
      workout as never,
      exercise as never,
      sets as never,
    );
  });

  const cases: Array<{
    name: keyof TrainingProgramsService;
    target: ReturnType<typeof vi.fn>;
    args: unknown[];
  }> = [
    { name: 'create', target: crud.create, args: [actor, programInput] },
    { name: 'findMany', target: crud.findMany, args: [actor, query] },
    { name: 'findOne', target: crud.findOne, args: [programId, actor] },
    { name: 'archive', target: crud.archive, args: [programId, actor] },
    { name: 'findVersions', target: version.findVersions, args: [programId, actor] },
    { name: 'findVersion', target: version.findVersion, args: [programId, versionId, actor] },
    { name: 'createNextDraft', target: version.createNextDraft, args: [programId, actor] },
    {
      name: 'updateDraftVersion',
      target: version.updateDraftVersion,
      args: [programId, versionId, actor, { durationWeeks: 6 }],
    },
    { name: 'publishVersion', target: version.publishVersion, args: [programId, versionId, actor] },
    {
      name: 'createWorkout', target: workout.createWorkout,
      args: [actor, programId, versionId, workoutInput],
    },
    {
      name: 'updateWorkout', target: workout.updateWorkout,
      args: [actor, programId, versionId, workoutId, { title: 'Pull' }],
    },
    {
      name: 'deleteWorkout', target: workout.deleteWorkout,
      args: [actor, programId, versionId, workoutId],
    },
    {
      name: 'addExercise', target: exercise.addExercise,
      args: [actor, programId, versionId, workoutId, { exerciseId: 'library-exercise-1' }],
    },
    {
      name: 'updateExercise', target: exercise.updateExercise,
      args: [actor, programId, versionId, workoutId, programExerciseId, { notes: 'Pause' }],
    },
    {
      name: 'removeExercise', target: exercise.removeExercise,
      args: [actor, programId, versionId, workoutId, programExerciseId],
    },
    {
      name: 'reorderExercises', target: exercise.reorderExercises,
      args: [actor, programId, versionId, workoutId, { exerciseIds: [programExerciseId] }],
    },
    {
      name: 'addSet', target: sets.addSet,
      args: [actor, programId, versionId, workoutId, programExerciseId, setInput],
    },
    {
      name: 'updateSet', target: sets.updateSet,
      args: [actor, programId, versionId, workoutId, programExerciseId, setId, { plannedReps: 12 }],
    },
    {
      name: 'removeSet', target: sets.removeSet,
      args: [actor, programId, versionId, workoutId, programExerciseId, setId],
    },
    {
      name: 'reorderSets', target: sets.reorderSets,
      args: [actor, programId, versionId, workoutId, programExerciseId, { setIds: [setId] }],
    },
    {
      name: 'assignVersionToAthlete', target: assignment.assignVersionToAthlete,
      args: [actor, programId, versionId, { trainerAthleteId: 'relationship-1' }],
    },
    {
      name: 'findManyAssignments', target: assignment.findManyAssignments,
      args: [actor, { ...query, view: 'summary' }],
    },
    {
      name: 'findOneAssignment', target: assignment.findOneAssignment,
      args: [assignmentId, actor],
    },
    {
      name: 'findOneAssignmentDetails', target: assignment.findOneAssignmentDetails,
      args: [assignmentId, actor],
    },
    {
      name: 'completeAssignment', target: assignment.completeAssignment,
      args: [assignmentId, actor],
    },
    {
      name: 'cancelAssignment', target: assignment.cancelAssignment,
      args: [assignmentId, actor, { reason: 'Replaced' }],
    },
  ];

  it.each(cases)('forwards $name arguments and returns the original result', async ({ name, target, args }) => {
    const result = { operation: name, id: 'result-1' };
    target.mockResolvedValue(result);

    const method = service[name] as (...parameters: unknown[]) => Promise<unknown>;
    await expect(method.apply(service, args)).resolves.toBe(result);
    expect(target).toHaveBeenCalledExactlyOnceWith(...args);
  });

  it('passes an empty reason object for cancellation without optional input', async () => {
    await service.cancelAssignment(assignmentId, actor);
    expect(assignment.cancelAssignment).toHaveBeenCalledExactlyOnceWith(
      assignmentId, actor, {},
    );
  });

  it('does not swallow nested service authorization or conflict errors', async () => {
    const conflict = new ConflictException('Version has been published');
    version.publishVersion.mockRejectedValue(conflict);
    await expect(service.publishVersion(programId, versionId, actor))
      .rejects.toBe(conflict);
  });
});
