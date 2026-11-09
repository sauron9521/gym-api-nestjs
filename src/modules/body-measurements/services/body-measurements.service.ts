import { Injectable, NotFoundException } from '@nestjs/common';

import type {
  CreateBodyMeasurementDto,
  QueryBodyMeasurementsDto,
  UpdateBodyMeasurementDto,
} from '../dto/body-measurement.schemas.js';
import {
  mapMeasurementChanges,
  mapMeasurementResponse,
} from '../mappers/body-measurement.mapper.js';
import { BodyMeasurementsRepository } from '../repositories/body-measurements.repository.js';

@Injectable()
export class BodyMeasurementsService {
  constructor(private readonly repository: BodyMeasurementsRepository) {}

  async create(userId: string, input: CreateBodyMeasurementDto) {
    const data = mapMeasurementChanges(input);
    return mapMeasurementResponse(await this.repository.create(userId, data));
  }

  async findMany(userId: string, query: QueryBodyMeasurementsDto) {
    const result = await this.repository.findMany(userId, {
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
    });
    return {
      data: result.data.map((item) => mapMeasurementResponse(item)),
      meta: result.meta,
    };
  }

  async findOne(userId: string, id: string) {
    const value = await this.repository.findOne(userId, id);
    if (!value) throw new NotFoundException('Body measurement not found');
    return mapMeasurementResponse(value);
  }

  async update(userId: string, id: string, input: UpdateBodyMeasurementDto) {
    const result = await this.repository.update(userId, id, mapMeasurementChanges(input));
    if (!result) throw new NotFoundException('Body measurement not found');
    return mapMeasurementResponse(result);
  }

  async remove(userId: string, id: string): Promise<void> {
    if (!(await this.repository.remove(userId, id))) {
      throw new NotFoundException('Body measurement not found');
    }
  }

}
