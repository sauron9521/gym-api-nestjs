import { Module } from '@nestjs/common';

import { ExercisesController } from './exercises.controller.js';
import { ExercisesRepository } from './exercises.repository.js';
import { ExercisesService } from './exercises.service.js';

@Module({
  controllers: [ExercisesController],
  providers: [ExercisesRepository, ExercisesService],
  exports: [ExercisesService],
})
export class ExercisesModule {}
