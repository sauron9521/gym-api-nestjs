import { TrainingProgramSetRepository } from '../repositories/training-program-set.repository.js';
import { TrainingProgramExerciseRepository } from '../repositories/training-program-exercise.repository.js';
import { TrainingProgramWorkoutRepository } from '../repositories/training-program-workout.repository.js';
import { trainingProgramVersionSelect } from '../selects/training-program-version.select.js';
import {
  trainingProgramExerciseOrderSelect,
  trainingProgramSetOrderSelect,
} from '../selects/training-program-query.select.js';

describe('Training program nested command repositories', () => {
  const prisma = {
    $transaction: vi.fn(),
    trainingProgramVersion: { update: vi.fn(), findUnique: vi.fn() },
    trainingProgramSet: { findMany: vi.fn(), update: vi.fn() },
    trainingProgramExercise: { findMany: vi.fn(), update: vi.fn() },
  };

  const programId = 'program-1';
  const versionId = 'version-1';
  const workoutId = 'workout-1';
  const programExerciseId = 'program-exercise-1';
  const draftWhere = { id: versionId, programId, status: 'DRAFT' };
  const projection = { id: versionId, workouts: [] };
  let sets: TrainingProgramSetRepository;
  let exercises: TrainingProgramExerciseRepository;
  let workouts: TrainingProgramWorkoutRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    sets = new TrainingProgramSetRepository(prisma as never);
    exercises = new TrainingProgramExerciseRepository(prisma as never);
    workouts = new TrainingProgramWorkoutRepository(prisma as never);
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    prisma.trainingProgramVersion.update.mockResolvedValue(projection);
    prisma.trainingProgramVersion.findUnique.mockResolvedValue(projection);
  });

  it('creates sets through an update constrained to the exact draft and its nested IDs', async () => {
    const result = await sets.createProgramSet(programId, versionId, workoutId, programExerciseId, {
      setNumber: 1, plannedReps: 10, plannedWeightKg: 52.5,
    });
    expect(result).toBe(projection);
    expect(prisma.trainingProgramVersion.update).toHaveBeenCalledExactlyOnceWith({
      where: draftWhere,
      data: {
        updatedAt: expect.any(Date),
        workouts: {
          update: {
            where: { id: workoutId },
            data: { exercises: {
              update: {
                where: { id: programExerciseId },
                data: { sets: { create: {
                  setNumber: 1, plannedReps: 10, plannedWeightKg: 52.5, setType: 'WORKING',
                } } },
              },
            } },
          },
        },
      },
      select: trainingProgramVersionSelect,
    });
  });

  it('preserves an explicit set type on creation', async () => {
    await sets.createProgramSet(programId, versionId, workoutId, programExerciseId, {
      setNumber: 2, setType: 'AMRAP',
    });
    const command = prisma.trainingProgramVersion.update.mock.calls[0]?.[0];
    expect(command.data.workouts.update.data.exercises.update.data.sets.create.setType)
      .toBe('AMRAP');
  });

  it('updates only the given set through its parent draft', async () => {
    await sets.updateProgramSet(programId, versionId, workoutId, programExerciseId, 'set-1', {
      plannedReps: 8, notes: null,
    });
    const command = prisma.trainingProgramVersion.update.mock.calls[0]?.[0];
    expect(command.where).toEqual(draftWhere);
    expect(command.data.workouts.update.data.exercises.update.data.sets.update)
      .toEqual({ where: { id: 'set-1' }, data: { plannedReps: 8, notes: null } });
  });

  it('deletes only the requested set through its nested draft', async () => {
    await sets.deleteProgramSet(programId, versionId, workoutId, programExerciseId, 'set-1');
    const command = prisma.trainingProgramVersion.update.mock.calls[0]?.[0];
    expect(command.where).toEqual(draftWhere);
    expect(command.data.workouts.update.data.exercises.update.data.sets.delete)
      .toEqual({ id: 'set-1' });
  });

  it('reorders sets in two phases, never colliding with existing unique positions', async () => {
    prisma.trainingProgramSet.findMany.mockResolvedValue([
      { id: 'set-a', setNumber: 1 },
      { id: 'set-b', setNumber: 2 },
    ]);
    await expect(sets.reorderProgramSets(
      programId, versionId, workoutId, programExerciseId, ['set-b', 'set-a'],
    )).resolves.toBe(projection);
    expect(prisma.trainingProgramVersion.update).toHaveBeenCalledExactlyOnceWith({
      where: draftWhere,
      data: { updatedAt: expect.any(Date) },
    });
    expect(prisma.trainingProgramSet.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { programExerciseId }, select: trainingProgramSetOrderSelect,
    });
    expect(prisma.trainingProgramSet.update).toHaveBeenCalledTimes(4);
    expect(prisma.trainingProgramSet.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'set-b', programExerciseId }, data: { setNumber: 6 },
    });
    expect(prisma.trainingProgramSet.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'set-a', programExerciseId }, data: { setNumber: 7 },
    });
    expect(prisma.trainingProgramSet.update).toHaveBeenNthCalledWith(3, {
      where: { id: 'set-b', programExerciseId }, data: { setNumber: 1 },
    });
    expect(prisma.trainingProgramSet.update).toHaveBeenNthCalledWith(4, {
      where: { id: 'set-a', programExerciseId }, data: { setNumber: 2 },
    });
    expect(prisma.trainingProgramVersion.findUnique).toHaveBeenCalledWith({
      where: { id: versionId }, select: trainingProgramVersionSelect,
    });
  });

  it.each([
    { setIds: ['set-a'], label: 'missing' },
    { setIds: ['set-a', 'set-a'], label: 'duplicate' },
    { setIds: ['set-a', 'foreign'], label: 'foreign' },
  ])('rejects a $label set order after the authoritative re-read', async ({ setIds }) => {
    prisma.trainingProgramSet.findMany.mockResolvedValue([
      { id: 'set-a', setNumber: 1 }, { id: 'set-b', setNumber: 2 },
    ]);
    await expect(sets.reorderProgramSets(
      programId, versionId, workoutId, programExerciseId, setIds,
    )).rejects.toThrow('INVALID_SET_ORDER');
    expect(prisma.trainingProgramSet.update).not.toHaveBeenCalled();
  });

  it('does not reorder sets when the draft lock fails', async () => {
    prisma.trainingProgramVersion.update.mockRejectedValue(new Error('DRAFT_CHANGED'));
    await expect(sets.reorderProgramSets(
      programId, versionId, workoutId, programExerciseId, [],
    )).rejects.toThrow('DRAFT_CHANGED');
    expect(prisma.trainingProgramSet.findMany).not.toHaveBeenCalled();
  });

  it('creates a program exercise snapshot through the matching draft workout', async () => {
    await exercises.createProgramExercise(programId, versionId, workoutId, {
      exerciseId: 'library-1', exerciseNameSnapshot: 'Bench',
      exerciseTypeSnapshot: 'STRENGTH', sortOrder: 0, notes: null,
    });
    const command = prisma.trainingProgramVersion.update.mock.calls[0]?.[0];
    expect(command.where).toEqual(draftWhere);
    expect(command.data.workouts.update).toEqual({
      where: { id: workoutId },
      data: { exercises: { create: {
        exercise: { connect: { id: 'library-1' } },
        exerciseNameSnapshot: 'Bench',
        exerciseTypeSnapshot: 'STRENGTH',
        sortOrder: 0,
        notes: null,
      } } },
    });
  });

  it('updates only the requested program exercise', async () => {
    await exercises.updateProgramExercise(
      programId, versionId, workoutId, programExerciseId, { notes: 'Paused' },
    );
    const command = prisma.trainingProgramVersion.update.mock.calls[0]?.[0];
    expect(command.where).toEqual(draftWhere);
    expect(command.data.workouts.update.data.exercises.update).toEqual({
      where: { id: programExerciseId }, data: { notes: 'Paused' },
    });
  });

  it('deletes the requested program exercise without unscoped deleteMany', async () => {
    await exercises.deleteProgramExercise(programId, versionId, workoutId, programExerciseId);
    const command = prisma.trainingProgramVersion.update.mock.calls[0]?.[0];
    expect(command.where).toEqual(draftWhere);
    expect(command.data.workouts.update.data.exercises.delete)
      .toEqual({ id: programExerciseId });
  });

  it('reorders exercises using temporary positions above the current maximum', async () => {
    prisma.trainingProgramExercise.findMany.mockResolvedValue([
      { id: 'exercise-a', sortOrder: 0 }, { id: 'exercise-b', sortOrder: 1 },
    ]);
    await expect(exercises.reorderProgramExercises(
      programId, versionId, workoutId, ['exercise-b', 'exercise-a'],
    )).resolves.toBe(projection);
    expect(prisma.trainingProgramVersion.update).toHaveBeenCalledExactlyOnceWith({
      where: draftWhere, data: { updatedAt: expect.any(Date) },
    });
    expect(prisma.trainingProgramExercise.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { workoutId }, select: trainingProgramExerciseOrderSelect,
    });
    expect(prisma.trainingProgramExercise.update).toHaveBeenCalledTimes(4);
    expect(prisma.trainingProgramExercise.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'exercise-b', workoutId }, data: { sortOrder: 4 },
    });
    expect(prisma.trainingProgramExercise.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'exercise-a', workoutId }, data: { sortOrder: 5 },
    });
    expect(prisma.trainingProgramExercise.update).toHaveBeenNthCalledWith(3, {
      where: { id: 'exercise-b', workoutId }, data: { sortOrder: 0 },
    });
    expect(prisma.trainingProgramExercise.update).toHaveBeenNthCalledWith(4, {
      where: { id: 'exercise-a', workoutId }, data: { sortOrder: 1 },
    });
  });

  it.each([
    ['exercise-a'],
    ['exercise-a', 'exercise-a'],
    ['exercise-a', 'foreign'],
  ])('rejects an invalid exercise order %j without mutating positions', async (...exerciseIds) => {
    prisma.trainingProgramExercise.findMany.mockResolvedValue([
      { id: 'exercise-a', sortOrder: 0 }, { id: 'exercise-b', sortOrder: 1 },
    ]);
    await expect(exercises.reorderProgramExercises(
      programId, versionId, workoutId, exerciseIds,
    )).rejects.toThrow('INVALID_EXERCISE_ORDER');
    expect(prisma.trainingProgramExercise.update).not.toHaveBeenCalled();
  });

  it('does not reorder exercises after draft editability is lost', async () => {
    prisma.trainingProgramVersion.update.mockRejectedValue(new Error('DRAFT_CHANGED'));
    await expect(exercises.reorderProgramExercises(
      programId, versionId, workoutId, [],
    )).rejects.toThrow('DRAFT_CHANGED');
    expect(prisma.trainingProgramExercise.findMany).not.toHaveBeenCalled();
  });

  it('creates a workout as a nested write of a draft only', async () => {
    const input = { weekNumber: 1, dayNumber: 1, title: 'Push' };
    await expect(workouts.createWorkout(programId, versionId, input))
      .resolves.toBe(projection);
    expect(prisma.trainingProgramVersion.update).toHaveBeenCalledExactlyOnceWith({
      where: draftWhere,
      data: { updatedAt: expect.any(Date), workouts: { create: input } },
      select: trainingProgramVersionSelect,
    });
  });

  it('updates a workout without detaching it from its parent draft', async () => {
    await workouts.updateWorkout(programId, versionId, workoutId, { title: 'Pull' });
    expect(prisma.trainingProgramVersion.update).toHaveBeenCalledExactlyOnceWith({
      where: draftWhere,
      data: {
        updatedAt: expect.any(Date),
        workouts: { update: {
          where: { id: workoutId }, data: { title: 'Pull' },
        } },
      },
      select: trainingProgramVersionSelect,
    });
  });

  it('deletes a workout through its draft version', async () => {
    await workouts.deleteWorkout(programId, versionId, workoutId);
    expect(prisma.trainingProgramVersion.update).toHaveBeenCalledExactlyOnceWith({
      where: draftWhere,
      data: {
        updatedAt: expect.any(Date),
        workouts: { delete: { id: workoutId } },
      },
      select: trainingProgramVersionSelect,
    });
  });
});
