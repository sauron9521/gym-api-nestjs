import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  assertCanManageExercise,
  buildExerciseManagementLookupWhere,
  buildExerciseVisibilityWhere,
  getExerciseManagementWhere,
  resolveExerciseSource,
  resolveExerciseVisibility,
} from '../policies/exercise-access.policy.js';
import type { ExerciseActor, ExerciseAccessContext } from '../types/exercise.types.js';

const trainer: ExerciseActor = { id: 'trainer-1', role: 'TRAINER' };
const athlete: ExerciseActor = { id: 'athlete-1', role: 'ATHLETE' };
const admin: ExerciseActor = { id: 'admin-1', role: 'ADMIN' };
const access: ExerciseAccessContext = {
  activeTrainerIds: ['trainer-1'],
  activeAthleteIds: ['athlete-1'],
};

describe('exercise access policy', () => {
  it('restricts guests to global exercises', () => {
    expect(buildExerciseVisibilityWhere(null, access)).toEqual({ source: 'GLOBAL' });
  });

  it('allows athletes their own and active trainers custom exercises', () => {
    expect(buildExerciseVisibilityWhere(athlete, access)).toEqual({
      OR: [
        { source: 'GLOBAL' },
        { source: 'ATHLETE_CUSTOM', createdById: athlete.id },
        {
          source: 'TRAINER_CUSTOM',
          createdById: { in: ['trainer-1'] },
          createdBy: {
            is: {
              trainerRelationships: {
                some: { athleteId: athlete.id, status: 'ACTIVE' },
              },
            },
          },
        },
      ],
    });
  });

  it('requires an explicit, unrevoked grant for trainer access to athlete exercises', () => {
    expect(buildExerciseVisibilityWhere(trainer, access)).toEqual({
      OR: [
        { source: 'GLOBAL' },
        { source: 'TRAINER_CUSTOM', createdById: trainer.id },
        {
          source: 'ATHLETE_CUSTOM',
          visibility: 'SELECTED_TRAINERS',
          createdById: { in: ['athlete-1'] },
          trainerAccesses: { some: { trainerId: trainer.id, revokedAt: null } },
          createdBy: {
            is: {
              athleteRelationships: {
                some: { trainerId: trainer.id, status: 'ACTIVE' },
              },
            },
          },
        },
      ],
    });
  });

  it('does not substitute the cached actor context for a current relationship check', () => {
    const context = {
      activeTrainerIds: ['former-trainer'],
      activeAthleteIds: ['former-athlete'],
    };
    const athleteScope = buildExerciseVisibilityWhere(athlete, context);
    const trainerScope = buildExerciseVisibilityWhere(trainer, context);
    expect(athleteScope).toEqual(expect.objectContaining({
      OR: expect.arrayContaining([
        expect.objectContaining({
          createdById: { in: ['former-trainer'] },
          createdBy: {
            is: {
              trainerRelationships: {
                some: { athleteId: athlete.id, status: 'ACTIVE' },
              },
            },
          },
        }),
      ]),
    }));
    expect(trainerScope).toEqual(expect.objectContaining({
      OR: expect.arrayContaining([
        expect.objectContaining({
          createdById: { in: ['former-athlete'] },
          trainerAccesses: { some: { trainerId: trainer.id, revokedAt: null } },
          createdBy: {
            is: {
              athleteRelationships: {
                some: { trainerId: trainer.id, status: 'ACTIVE' },
              },
            },
          },
        }),
      ]),
    }));
  });

  it('keeps existing admin read and global-source behavior', () => {
    expect(buildExerciseVisibilityWhere(admin, access)).toEqual({});
    expect(resolveExerciseSource(admin)).toBe('GLOBAL');
    expect(resolveExerciseSource(trainer)).toBe('TRAINER_CUSTOM');
    expect(resolveExerciseSource(athlete)).toBe('ATHLETE_CUSTOM');
  });

  it('keeps private as athlete default and rejects visibility on non-athlete exercises', () => {
    expect(resolveExerciseVisibility('ATHLETE_CUSTOM')).toBe('PRIVATE');
    expect(resolveExerciseVisibility('ATHLETE_CUSTOM', 'SELECTED_TRAINERS'))
      .toBe('SELECTED_TRAINERS');
    expect(resolveExerciseVisibility('TRAINER_CUSTOM')).toBeNull();
    expect(() => resolveExerciseVisibility('TRAINER_CUSTOM', 'PRIVATE'))
      .toThrow(BadRequestException);
  });

  it.each([athlete, trainer, admin])('limits management lookups to global and actor-owned exercises: %s', (actor) => {
    expect(buildExerciseManagementLookupWhere(actor)).toEqual({
      isArchived: false,
      OR: [
        { source: 'GLOBAL' },
        { source: { not: 'GLOBAL' }, createdById: actor.id },
      ],
    });
  });

  it('preserves 403 for visible global resources and 404 for foreign custom resources', () => {
    const global = { id: 'ex-global', source: 'GLOBAL' as const, createdById: null };
    const foreign = { id: 'ex-private', source: 'ATHLETE_CUSTOM' as const, createdById: 'other-user' };
    expect(() => assertCanManageExercise(athlete, global)).toThrow(ForbiddenException);
    expect(() => assertCanManageExercise(trainer, global)).toThrow(ForbiddenException);
    expect(() => assertCanManageExercise(admin, global)).not.toThrow();
    for (const actor of [athlete, trainer, admin]) {
      expect(() => assertCanManageExercise(actor, foreign)).toThrow(NotFoundException);
    }
  });

  it('enforces ownership for writes and scopes conditional update predicates', () => {
    const own = { id: 'ex-1', source: 'ATHLETE_CUSTOM' as const, createdById: athlete.id };
    expect(() => assertCanManageExercise(athlete, own)).not.toThrow();
    expect(getExerciseManagementWhere(athlete, own)).toEqual({
      id: 'ex-1',
      createdById: athlete.id,
      source: 'ATHLETE_CUSTOM',
      isArchived: false,
    });
    expect(() => assertCanManageExercise(trainer, own)).toThrow(NotFoundException);
    const global = { id: 'ex-2', source: 'GLOBAL' as const, createdById: null };
    expect(() => assertCanManageExercise(admin, global)).not.toThrow();
    expect(getExerciseManagementWhere(admin, global)).toEqual({
      id: 'ex-2', source: 'GLOBAL', isArchived: false,
    });
  });
});
