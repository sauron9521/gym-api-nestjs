import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { ExerciseSource, ExerciseVisibility, Prisma } from '#prisma/client';
import type { ExerciseAccessContext, ExerciseActor } from '../types/exercise.types.js';

/** Centralizes all exercise read and write visibility rules. */
export function buildExerciseVisibilityWhere(
    actor: ExerciseActor | null,
    access: ExerciseAccessContext,
  ): Prisma.ExerciseWhereInput {
    if (!actor) {
      return { source: 'GLOBAL' };
    }

    if (actor.role === 'ADMIN') {
      return {};
    }

    if (actor.role === 'ATHLETE') {
      return {
        OR: [
          { source: 'GLOBAL' },

          {
            source: 'ATHLETE_CUSTOM',
            createdById: actor.id,
          },

          {
            source: 'TRAINER_CUSTOM',
            createdById: {
              in: access.activeTrainerIds,
            },
          },
        ],
      };
    }

    if (actor.role === 'TRAINER') {
      return {
        OR: [
          { source: 'GLOBAL' },

          {
            source: 'TRAINER_CUSTOM',
            createdById: actor.id,
          },

          {
            source: 'ATHLETE_CUSTOM',
            visibility: 'SELECTED_TRAINERS',
            createdById: {
              in: access.activeAthleteIds,
            },
            trainerAccesses: {
              some: {
                trainerId: actor.id,
                revokedAt: null,
              },
            },
          },
        ],
      };
    }

    throw new ForbiddenException();
  }

export function resolveExerciseSource(actor: ExerciseActor): ExerciseSource {
    switch (actor.role) {
      case 'ADMIN':
        return 'GLOBAL';

      case 'TRAINER':
        return 'TRAINER_CUSTOM';

      case 'ATHLETE':
        return 'ATHLETE_CUSTOM';

      default:
        throw new ForbiddenException('You cannot create exercises');
    }
  }

export function resolveExerciseVisibility(
    source: ExerciseSource,
    requested?: ExerciseVisibility,
  ): ExerciseVisibility | null {
    if (source !== 'ATHLETE_CUSTOM') {
      if (requested !== undefined) {
        throw new BadRequestException(
          'Visibility is only available for athlete custom exercises',
        );
      }

      return null;
    }

    return requested ?? 'PRIVATE';
  }

export function assertCanManageExercise(
    actor: ExerciseActor,
    exercise: {
      source: ExerciseSource;
      createdById: string | null;
    },
  ): void {
    if (actor.role === 'ADMIN' && exercise.source === 'GLOBAL') {
      return;
    }

    if (exercise.source !== 'GLOBAL' && exercise.createdById === actor.id) {
      return;
    }

    throw new ForbiddenException('You cannot modify this exercise');
  }

export function getExerciseManagementWhere(
    actor: ExerciseActor,
    exercise: {
      id: string;
      source: ExerciseSource;
      createdById: string | null;
    },
  ): Prisma.ExerciseWhereUniqueInput {
    if (actor.role === 'ADMIN' && exercise.source === 'GLOBAL') {
      return {
        id: exercise.id,
        source: 'GLOBAL',
        isArchived: false,
      };
    }

    return {
      id: exercise.id,
      createdById: actor.id,
      source: exercise.source,
      isArchived: false,
    };
  }
