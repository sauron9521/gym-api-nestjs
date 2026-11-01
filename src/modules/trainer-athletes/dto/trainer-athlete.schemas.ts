import { z } from 'zod';

export const trainerAthleteIdSchema = z.string().uuid();

export const trainerAthleteStatusSchema = z.enum([
  'PENDING',
  'ACTIVE',
  'DECLINED',
  'CANCELLED',
  'TERMINATED',
]);
