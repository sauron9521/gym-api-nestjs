import { Module } from '@nestjs/common';

import { ExercisesController } from './exercises.controller.js';
import { ExercisesRepository } from './exercises.repository.js';
import { ExercisesService } from './exercises.service.js';
import { TrainerAthletesModule } from '#src/modules/trainer-athletes/trainer-athletes.module';

@Module({
  imports: [TrainerAthletesModule],
  controllers: [ExercisesController],
  providers: [ExercisesRepository, ExercisesService],
  exports: [ExercisesService],
})
export class ExercisesModule {}
