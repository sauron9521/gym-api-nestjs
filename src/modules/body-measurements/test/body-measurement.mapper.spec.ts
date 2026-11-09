import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  mapMeasurementChanges,
  mapMeasurementResponse,
} from '../mappers/body-measurement.mapper.js';
import type { MeasurementRecord } from '../types/body-measurement.types.js';

describe('body measurement mappers', () => {
  const record = {
    id: 'measurement-1',
    measuredAt: new Date('2026-11-08T10:00:00.000Z'),
    weightKg: { toString: () => '81.25' },
    bodyFatPct: { toString: () => '0.00' },
    chestCm: null,
    waistCm: null,
    hipsCm: null,
    armCm: null,
    thighCm: null,
    notes: null,
    createdAt: new Date('2026-11-08T10:00:00.000Z'),
    updatedAt: new Date('2026-11-08T10:00:00.000Z'),
  } as MeasurementRecord;

  it('converts decimal metrics to numbers, preserves nulls and omits ownership', () => {
    const response = mapMeasurementResponse(record);
    expect(response).toEqual({
      id: 'measurement-1',
      measuredAt: record.measuredAt,
      weightKg: 81.25,
      bodyFatPct: 0,
      chestCm: null,
      waistCm: null,
      hipsCm: null,
      armCm: null,
      thighCm: null,
      notes: null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
    expect(response).not.toHaveProperty('userId');
  });

  it('normalizes an ISO offset without altering the instant', () => {
    expect(mapMeasurementChanges({
      weightKg: 81.25,
      measuredAt: '2026-11-08T12:00:00+02:00',
    })).toEqual({
      weightKg: 81.25,
      measuredAt: new Date('2026-11-08T10:00:00.000Z'),
    });
  });

  it('preserves omitted metrics and explicit null clearing in PATCH', () => {
    expect(mapMeasurementChanges({ waistCm: null, notes: 'New note' })).toEqual({
      waistCm: null,
      notes: 'New note',
    });
    expect(mapMeasurementChanges({ weightKg: 81.25 })).toEqual({
      weightKg: 81.25,
    });
  });

  it('rejects out-of-range timestamps without changing validation behavior', () => {
    expect(() => mapMeasurementChanges({
      weightKg: 81,
      measuredAt: '2099-01-01T00:00:00Z',
    })).toThrow(BadRequestException);

    expect(() => mapMeasurementChanges({
      weightKg: 81,
      measuredAt: '1899-12-31T23:59:59Z',
    })).toThrow('measuredAt must be between 1900-01-01 and now');
  });
});
