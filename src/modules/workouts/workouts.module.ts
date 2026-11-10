import { Module } from '@nestjs/common';

import { ExercisesModule } from '#src/modules/exercises/exercises.module';
import { TrainerAthletesModule } from '#src/modules/trainer-athletes/trainer-athletes.module';

import { WorkoutsRepository } from './repositories/workouts.repository.js';
import { WorkoutCreationRepository } from './repositories/workout-creation.repository.js';
import { WorkoutLifecycleRepository } from './repositories/workout-lifecycle.repository.js';
import { WorkoutSetsRepository } from './repositories/workout-sets.repository.js';
import { WorkoutsService } from './services/workouts.service.js';
import { WorkoutsController } from './controllers/workouts.controller.js';

@Module({
  imports: [ExercisesModule, TrainerAthletesModule],
  providers: [
    WorkoutCreationRepository,
    WorkoutLifecycleRepository,
    WorkoutSetsRepository,
    WorkoutsRepository,
    WorkoutsService,
  ],
  controllers: [WorkoutsController],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
