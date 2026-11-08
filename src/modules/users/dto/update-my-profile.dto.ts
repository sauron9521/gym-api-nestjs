import { z } from 'zod';

/** PATCH /users/me: personal profile fields only. Account roles, email
 * and credentials must use separate, explicitly authorized flows. */
export const updateMyProfileSchema = z
  .strictObject({
    // name is the legacy alias of displayName; do not remove it.
    name: z.string().trim().min(1).max(100).nullable().optional(),
    firstName: z.string().trim().min(1).max(100).nullable().optional(),
    lastName: z.string().trim().min(1).max(100).nullable().optional(),
    displayName: z.string().trim().min(1).max(100).nullable().optional(),
    avatarUrl: z
      .url()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          // URLs are displayed by clients, never fetched by this API.
          return url.protocol === 'https:' && !url.username && !url.password;
        } catch {
          return false;
        }
      }, 'Avatar URL must be HTTPS and contain no credentials')
      .nullable()
      .optional(),
    timezone: z.string().trim().min(1).max(64).refine(
      (value) => {
        if (value !== 'UTC' && !/^[A-Za-z_]+\/[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)?$/.test(value)) {
          return false;
        }
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      },
      'Use an IANA time zone (e.g. Europe/Kyiv) or UTC',
    ).optional(),
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
  )
  .refine(
    (data) =>
      data.name === undefined ||
      data.displayName === undefined ||
      data.name === data.displayName,
    {
      message: 'name and displayName must match when both are supplied',
      path: ['displayName'],
    },
  );

export type UpdateMyProfileDto = z.infer<typeof updateMyProfileSchema>;
