import { Module } from '@nestjs/common';

import { ExercisesModule } from '#src/modules/exercises/exercises.module';
import { TrainerAthletesModule } from '#src/modules/trainer-athletes/trainer-athletes.module';

import { WorkoutsRepository } from './workouts.repository.js';
import { WorkoutsService } from './workouts.service.js';
import { WorkoutsController } from './workouts.controller.js';

@Module({
  imports: [ExercisesModule, TrainerAthletesModule],
  providers: [WorkoutsRepository, WorkoutsService],
  controllers: [WorkoutsController],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
