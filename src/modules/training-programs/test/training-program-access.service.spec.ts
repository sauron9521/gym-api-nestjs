import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { TrainingProgramAccessService } from '../services/training-program-access.service.js';
import type { TrainingProgramActor } from '../types/training-program.types.js';

describe('TrainingProgramAccessService', () => {
  const programs = { findProgramById: vi.fn() };
  const versions = { findVersionForEditing: vi.fn() };

  const trainer: TrainingProgramActor = { id: 'trainer-1', role: 'TRAINER' };
  const athlete: TrainingProgramActor = { id: 'athlete-1', role: 'ATHLETE' };
  const otherTrainer: TrainingProgramActor = { id: 'trainer-2', role: 'TRAINER' };

  const draft = () => ({
    id: 'version-1',
    status: 'DRAFT' as const,
    durationWeeks: 4,
    workouts: [{
      id: 'workout-1',
      exercises: [{ id: 'program-exercise-1', sortOrder: 0, sets: [{ id: 'set-1', setNumber: 1 }] }],
    }],
  });

  let service: TrainingProgramAccessService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new TrainingProgramAccessService(programs as never, versions as never);
    programs.findProgramById.mockResolvedValue({
      id: 'program-1',
      trainerId: trainer.id,
      status: 'DRAFT',
    });
    versions.findVersionForEditing.mockResolvedValue(draft());
  });

  it('only permits trainers to manage training programs', () => {
    expect(() => service.assertTrainer(trainer)).not.toThrow();
    expect(() => service.assertTrainer(athlete)).toThrow(ForbiddenException);
  });

  it('rejects non-trainers before any database lookup', async () => {
    await expect(service.assertEditableDraft(athlete, 'program-1', 'version-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(programs.findProgramById).not.toHaveBeenCalled();
    expect(versions.findVersionForEditing).not.toHaveBeenCalled();
  });

  it('limits program visibility to the acting trainer', async () => {
    programs.findProgramById.mockResolvedValue(null);

    await expect(service.assertEditableDraft(otherTrainer, 'program-1', 'version-1'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(programs.findProgramById).toHaveBeenCalledExactlyOnceWith('program-1', {
      trainerId: otherTrainer.id,
    });
    expect(versions.findVersionForEditing).not.toHaveBeenCalled();
  });

  it('rejects an unknown program without checking its version', async () => {
    programs.findProgramById.mockResolvedValue(null);

    await expect(service.assertEditableDraft(trainer, 'missing', 'version-1'))
      .rejects.toThrow('Training program not found.');
    expect(versions.findVersionForEditing).not.toHaveBeenCalled();
  });

  it('rejects archived programs before loading draft data', async () => {
    programs.findProgramById.mockResolvedValue({
      id: 'program-1', trainerId: trainer.id, status: 'ARCHIVED',
    });

    await expect(service.assertEditableDraft(trainer, 'program-1', 'version-1'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(versions.findVersionForEditing).not.toHaveBeenCalled();
  });

  it('scopes draft version lookup to the program ID', async () => {
    const result = await service.assertEditableDraft(trainer, 'program-1', 'version-1');

    expect(versions.findVersionForEditing).toHaveBeenCalledExactlyOnceWith(
      'version-1',
      { programId: 'program-1' },
    );
    expect(result).toEqual(draft());
  });

  it('rejects a version that is not part of the requested program', async () => {
    versions.findVersionForEditing.mockResolvedValue(null);

    await expect(service.assertEditableDraft(trainer, 'program-1', 'other-version'))
      .rejects.toThrow(new NotFoundException('Program version not found.'));
  });

  it('disallows edits to published versions', async () => {
    versions.findVersionForEditing.mockResolvedValue({
      ...draft(), status: 'PUBLISHED',
    });

    await expect(service.assertEditableDraft(trainer, 'program-1', 'version-1'))
      .rejects.toThrow(new ConflictException('Only draft versions can be modified.'));
  });

  it('returns a workout only when it belongs to the editable draft', async () => {
    const result = await service.assertEditableWorkout(
      trainer, 'program-1', 'version-1', 'workout-1',
    );

    expect(result).toEqual(draft().workouts[0]);
    expect(versions.findVersionForEditing).toHaveBeenCalledExactlyOnceWith(
      'version-1',
      { programId: 'program-1' },
    );
  });

  it('hides a workout that is not part of the editable draft', async () => {
    await expect(service.assertEditableWorkout(
      trainer, 'program-1', 'version-1', 'foreign-workout',
    )).rejects.toThrow(new NotFoundException('Workout not found.'));
  });

  it('checks publication status before exposing a nested workout', async () => {
    versions.findVersionForEditing.mockResolvedValue({
      ...draft(), status: 'PUBLISHED',
    });

    await expect(service.assertEditableWorkout(
      trainer, 'program-1', 'version-1', 'workout-1',
    )).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns only an exercise nested in the requested editable workout', async () => {
    const result = await service.assertEditableProgramExercise(
      trainer, 'program-1', 'version-1', 'workout-1', 'program-exercise-1',
    );

    expect(result).toEqual(draft().workouts[0].exercises[0]);
  });

  it('hides an exercise outside the requested workout', async () => {
    await expect(service.assertEditableProgramExercise(
      trainer, 'program-1', 'version-1', 'workout-1', 'foreign-exercise',
    )).rejects.toThrow(new NotFoundException('Program exercise not found.'));
  });

  it('never checks a nested exercise when its workout is missing', async () => {
    await expect(service.assertEditableProgramExercise(
      trainer, 'program-1', 'version-1', 'foreign-workout', 'program-exercise-1',
    )).rejects.toThrow(new NotFoundException('Workout not found.'));
  });
});
