import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { BodyMeasurementsRepository, type MeasurementChanges } from './body-measurements.repository.js';
import type {
  CreateBodyMeasurementDto,
  QueryBodyMeasurementsDto,
  UpdateBodyMeasurementDto,
} from './dto/body-measurement.schemas.js';
import { metricKeys } from './dto/body-measurement.schemas.js';

type MeasurementResponse = NonNullable<
  Awaited<ReturnType<BodyMeasurementsRepository['findOne']>>
>;

@Injectable()
export class BodyMeasurementsService {
  constructor(private readonly repository: BodyMeasurementsRepository) {}

  async create(userId: string, input: CreateBodyMeasurementDto) {
    const data = this.toChanges(input);
    return this.toResponse(await this.repository.create(userId, data));
  }

  async findMany(userId: string, query: QueryBodyMeasurementsDto) {
    const result = await this.repository.findMany(userId, {
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
    });
    return {
      data: result.data.map((item) => this.toResponse(item)),
      meta: result.meta,
    };
  }

  async findOne(userId: string, id: string) {
    const value = await this.repository.findOne(userId, id);
    if (!value) throw new NotFoundException('Body measurement not found');
    return this.toResponse(value);
  }

  async update(userId: string, id: string, input: UpdateBodyMeasurementDto) {
    const result = await this.repository.update(userId, id, this.toChanges(input));
    if (!result) throw new NotFoundException('Body measurement not found');
    return this.toResponse(result);
  }

  async remove(userId: string, id: string): Promise<void> {
    if (!(await this.repository.remove(userId, id))) {
      throw new NotFoundException('Body measurement not found');
    }
  }

  private toChanges(
    input: CreateBodyMeasurementDto | UpdateBodyMeasurementDto,
  ): MeasurementChanges {
    const data = {
      ...input,
      ...(input.measuredAt
        ? { measuredAt: new Date(input.measuredAt) }
        : {}),
    };

    if (input.measuredAt) {
      const date = new Date(input.measuredAt);
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

    // Keep absence distinct from null. Repository handles partial updates.
    return data;
  }

  private toResponse(record: MeasurementResponse) {
    const metrics = Object.fromEntries(
      metricKeys.map((key) => [
        key, record[key] === null ? null : Number(record[key]),
      ]),
    );

    return {
      id: record.id,
      ...metrics,
      notes: record.notes,
      measuredAt: record.measuredAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
