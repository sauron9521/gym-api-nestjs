import { z } from 'zod';

/** PATCH /users/me: personal profile fields only. Account roles, email
 * and credentials must use separate, explicitly authorized flows. */
export const updateMyProfileSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100).nullable().optional(),
    birthday: z.iso
      .date()
      .refine(
        (value) =>
          value >= '1900-01-01' &&
          value <= new Date().toISOString().slice(0, 10),
        'Birthday must be between 1900-01-01 and today',
      )
      .nullable()
      .optional(),
    height: z.number().int().min(50).max(300).nullable().optional(),
    weight: z.number().finite().min(1).max(600).multipleOf(0.01).nullable().optional(),
  })
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    'At least one profile field is required',
  );

export type UpdateMyProfileDto = z.infer<typeof updateMyProfileSchema>;
