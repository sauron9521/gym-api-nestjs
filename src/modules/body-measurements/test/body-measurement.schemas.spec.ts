import {
  createBodyMeasurementSchema,
  queryBodyMeasurementsSchema,
  updateBodyMeasurementSchema,
} from '../dto/body-measurement.schemas.js';

describe('body measurements DTO', () => {
  it('accepts measurements with two decimal places', () => {
    const parsed = createBodyMeasurementSchema.parse({
      measuredAt: '2026-11-08T12:00:00+02:00',
      weightKg: 21.5,
      waistCm: 82.25,
      notes: '  Before breakfast  ',
    });
    expect(parsed).toMatchObject({
      weightKg: 21.5, waistCm: 82.25, notes: 'Before breakfast',
    });
  });

  it('requires a real metric, not just notes or empty input', () => {
    for (const value of [{}, { notes: 'note' }, { weightKg: null }]) {
      expect(createBodyMeasurementSchema.safeParse(value).success).toBe(false);
    }
  });

  it('rejects invalid precision, impossible numbers and unknown fields', () => {
    for (const value of [
      { weightKg: 80.555 }, { weightKg: 0 }, { weightKg: 601 },
      { chestCm: -1 }, { bodyFatPct: 120 }, { waistCm: 1000 },
      { weightKg: 80, userId: 'someone-else' },
      { weightKg: 80, measuredAt: 'yesterday' },
    ]) {
      expect(createBodyMeasurementSchema.safeParse(value).success).toBe(false);
    }
  });

  it('accepts nullable partial PATCH but rejects empty PATCH', () => {
    expect(updateBodyMeasurementSchema.safeParse({ weightKg: null }).success)
      .toBe(true);
    expect(updateBodyMeasurementSchema.safeParse({ notes: null }).success)
      .toBe(true);
    expect(updateBodyMeasurementSchema.safeParse({}).success).toBe(false);
  });

  it('applies pagination defaults and validates date range', () => {
    expect(queryBodyMeasurementsSchema.parse({})).toMatchObject({
      page: 1, limit: 20,
    });
    expect(queryBodyMeasurementsSchema.safeParse({ page: '0' }).success).toBe(false);
    expect(queryBodyMeasurementsSchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(queryBodyMeasurementsSchema.safeParse({
      from: '2026-11-09T00:00:00Z',
      to: '2026-11-08T00:00:00Z',
    }).success).toBe(false);
  });
});
