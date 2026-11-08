import { z } from 'zod';

const twoDecimals = (min: number, max: number) =>
  z.number().finite().min(min).max(max).multipleOf(0.01).nullable().optional();

export const measurementFields = {
  weightKg: twoDecimals(1, 600),
  bodyFatPct: twoDecimals(0, 100),
  chestCm: twoDecimals(1, 400),
  waistCm: twoDecimals(1, 400),
  hipsCm: twoDecimals(1, 400),
  armCm: twoDecimals(1, 200),
  thighCm: twoDecimals(1, 250),
} as const;

export const metricKeys = [
  'weightKg', 'bodyFatPct', 'chestCm', 'waistCm',
  'hipsCm', 'armCm', 'thighCm',
] as const;

const timestamp = z.iso.datetime({ offset: true });
const editableFields = {
  ...measurementFields,
  measuredAt: timestamp.optional(),
  notes: z.string().trim().min(1).max(500).nullable().optional(),
};

export const createBodyMeasurementSchema = z.strictObject(editableFields).refine(
  (data) => metricKeys.some((key) => data[key] !== undefined && data[key] !== null),
  'At least one body measurement metric must be supplied',
);

export const updateBodyMeasurementSchema = z.strictObject(editableFields).refine(
  (data) => Object.values(data).some((value) => value !== undefined),
  'At least one field must be supplied',
);

export const bodyMeasurementIdSchema = z.uuid();

export const queryBodyMeasurementsSchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: timestamp.optional(),
  to: timestamp.optional(),
}).refine(
  (value) => !value.from || !value.to ||
    Date.parse(value.from) <= Date.parse(value.to),
  { message: 'from must not be later than to', path: ['to'] },
);

export type CreateBodyMeasurementDto = z.infer<typeof createBodyMeasurementSchema>;
export type UpdateBodyMeasurementDto = z.infer<typeof updateBodyMeasurementSchema>;
export type QueryBodyMeasurementsDto = z.infer<typeof queryBodyMeasurementsSchema>;
