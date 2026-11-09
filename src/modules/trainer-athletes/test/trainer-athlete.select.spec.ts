import { describe, expect, it } from 'vitest';

import {
  trainerAthleteHistoricalSelect,
  trainerAthleteSelect,
} from '../selects/trainer-athlete.select.js';

describe('TrainerAthlete Prisma projections', () => {
  const participants = ['trainer', 'athlete', 'initiatedBy', 'endedBy'] as const;

  it('does not select email of any related user for historical trainer records', () => {
    for (const participant of participants) {
      expect(trainerAthleteHistoricalSelect[participant].select).not.toHaveProperty('email');
      expect(trainerAthleteHistoricalSelect[participant].select).toMatchObject({
        id: true,
        role: true,
      });
    }
  });

  it('retains existing account fields for open relationships and athlete history', () => {
    for (const participant of participants) {
      expect(trainerAthleteSelect[participant].select).toMatchObject({
        id: true,
        email: true,
        role: true,
      });
    }
  });

  it('retains relationship status and transition/audit fields in both variants', () => {
    for (const key of [
      'id', 'trainerId', 'athleteId', 'initiatedById', 'status',
      'respondedAt', 'endedAt', 'endedById', 'endReason',
      'createdAt', 'updatedAt',
    ] as const) {
      expect(trainerAthleteSelect[key]).toBe(true);
      expect(trainerAthleteHistoricalSelect[key]).toBe(true);
    }
  });
});
