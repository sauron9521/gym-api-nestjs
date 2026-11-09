import { BadRequestException } from '@nestjs/common';

import type {
  CreateBodyMeasurementDto,
  UpdateBodyMeasurementDto,
} from '../dto/body-measurement.schemas.js';
import type {
  MeasurementChanges,
  MeasurementRecord,
  MeasurementResponse,
} from '../types/body-measurement.types.js';

/** Preserve partial PATCH values: undefined is not the same as null. */
export function mapMeasurementChanges(
  input: CreateBodyMeasurementDto | UpdateBodyMeasurementDto,
): MeasurementChanges {
  const { measuredAt, ...fields } = input;
  const data: MeasurementChanges = {
    ...fields,
    ...(measuredAt ? { measuredAt: new Date(measuredAt) } : {}),
  };

  if (measuredAt) {
    const date = new Date(measuredAt);
    const today = Date.now();
    if (
      date.getTime() < Date.UTC(1900, 0, 1) ||
      date.getTime() > today + 60_000
    ) {
      throw new BadRequestException(
        'measuredAt must be between 1900-01-01 and now',
      );
    }
  }

  return data;
}

/** Stable HTTP contract: decimals as numbers, nullable metrics as null. */
export function mapMeasurementResponse(
  record: MeasurementRecord,
): MeasurementResponse {
  return {
    id: record.id,
    weightKg: record.weightKg === null ? null : Number(record.weightKg),
    bodyFatPct: record.bodyFatPct === null ? null : Number(record.bodyFatPct),
    chestCm: record.chestCm === null ? null : Number(record.chestCm),
    waistCm: record.waistCm === null ? null : Number(record.waistCm),
    hipsCm: record.hipsCm === null ? null : Number(record.hipsCm),
    armCm: record.armCm === null ? null : Number(record.armCm),
    thighCm: record.thighCm === null ? null : Number(record.thighCm),
    notes: record.notes,
    measuredAt: record.measuredAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
