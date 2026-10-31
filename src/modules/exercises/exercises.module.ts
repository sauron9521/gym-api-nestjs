import { Module } from '@nestjs/common';

import { ExercisesRepository } from './exercises.repository.js';
import { ExercisesService } from './exercises.service.js';

@Module({
  providers: [ExercisesRepository, ExercisesService],
  exports: [ExercisesService],
})
export class ExercisesModule {}
