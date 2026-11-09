import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ExerciseTrainerAccessRepository } from '../repositories/exercise-trainer-access.repository.js';
import type { ExerciseActor } from '../types/exercise.types.js';

@Injectable()
export class ExerciseTrainerAccessService {
  constructor(private readonly repository: ExerciseTrainerAccessRepository) {}

  async grant(exerciseId: string, actor: ExerciseActor, trainerId: string) {
    this.assertAthlete(actor);

    const result = await this.repository.grant(exerciseId, actor.id, trainerId);
    if (result.status === 'NOT_FOUND') {
      throw new NotFoundException('Exercise not found');
    }
    if (result.status === 'PRIVATE') {
      throw new ConflictException(
        'Set exercise visibility to SELECTED_TRAINERS before granting access',
      );
    }
    if (result.status === 'NO_ACTIVE_RELATIONSHIP') {
      throw new ConflictException('An active trainer-athlete relationship is required');
    }
    return result.grant;
  }

  async list(exerciseId: string, actor: ExerciseActor) {
    this.assertAthlete(actor);
    const result = await this.repository.list(exerciseId, actor.id);
    if (!result) {
      throw new NotFoundException('Exercise not found');
    }
    return result;
  }

  async revoke(exerciseId: string, actor: ExerciseActor, trainerId: string) {
    this.assertAthlete(actor);
    const owned = await this.repository.revoke(exerciseId, actor.id, trainerId);
    if (!owned) {
      throw new NotFoundException('Exercise not found');
    }
  }

  private assertAthlete(actor: ExerciseActor) {
    if (actor.role !== 'ATHLETE') {
      throw new ForbiddenException('Only athletes can share their personal exercises');
    }
  }
}
