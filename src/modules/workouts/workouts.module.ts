import { Module } from '@nestjs/common';

import { ExercisesModule } from '../exercises/exercises.module.js';
import { TrainerAthletesModule } from '../trainer-athletes/trainer-athletes.module.js';

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
