import { Module } from '@nestjs/common';

import { ExercisesModule } from '../exercises/exercises.module.js';
import { TrainerAthletesModule } from '../trainer-athletes/trainer-athletes.module.js';

import { TrainingProgramsController } from './training-programs.controller.js';
import { TrainingProgramsRepository } from './training-programs.repository.js';
import { TrainingProgramsService } from './training-programs.service.js';

import { TrainingProgramCrudRepository } from './repositories/training-program-crud.repository.js';
import { TrainingProgramVersionRepository } from './repositories/training-program-version.repository.js';
import { TrainingProgramAssignmentRepository } from './repositories/training-program-assignment.repository.js';
import { TrainingProgramExerciseRepository } from './repositories/training-program-exercise.repository.js';
import { TrainingProgramSetRepository } from './repositories/training-program-set.repository.js';
import { TrainingProgramWorkoutRepository } from './repositories/training-program-workout.repository.js';

@Module({
  imports: [ExercisesModule, TrainerAthletesModule],
  exports: [TrainingProgramsService],
  controllers: [TrainingProgramsController],
  providers: [
    TrainingProgramsService,
    TrainingProgramsRepository,

    TrainingProgramCrudRepository,
    TrainingProgramVersionRepository,
    TrainingProgramAssignmentRepository,
    TrainingProgramExerciseRepository,
    TrainingProgramSetRepository,
    TrainingProgramWorkoutRepository,
  ],
})
export class TrainingProgramsModule {}
