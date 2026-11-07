import { Module } from '@nestjs/common';

import { ExercisesModule } from '../exercises/exercises.module.js';
import { TrainerAthletesModule } from '../trainer-athletes/trainer-athletes.module.js';

import { TrainingProgramsController } from './training-programs.controller.js';
import { TrainingProgramsService } from './training-programs.service.js';

import { TrainingProgramCrudRepository } from './repositories/training-program-crud.repository.js';
import { TrainingProgramVersionRepository } from './repositories/training-program-version.repository.js';
import { TrainingProgramAssignmentRepository } from './repositories/training-program-assignment.repository.js';
import { TrainingProgramExerciseRepository } from './repositories/training-program-exercise.repository.js';
import { TrainingProgramSetRepository } from './repositories/training-program-set.repository.js';
import { TrainingProgramWorkoutRepository } from './repositories/training-program-workout.repository.js';

import { TrainingProgramAccessService } from './services/training-program-access.service.js';
import { TrainingProgramWorkoutService } from './services/training-program-workout.service.js';
import { TrainingProgramExerciseService } from './services/training-program-exercise.service.js';
import { TrainingProgramSetService } from './services/training-program-set.service.js';
import { TrainingProgramCrudService } from './services/training-program-crud.service.js';
import { TrainingProgramVersionService } from './services/training-program-version.service.js';
import { TrainingProgramAssignmentService } from './services/training-program-assignment.service.js';

@Module({
  imports: [ExercisesModule, TrainerAthletesModule],
  exports: [TrainingProgramsService],
  controllers: [TrainingProgramsController],
  providers: [
    TrainingProgramsService,

    TrainingProgramAccessService,
    TrainingProgramWorkoutService,
    TrainingProgramExerciseService,
    TrainingProgramSetService,
    TrainingProgramCrudService,
    TrainingProgramVersionService,
    TrainingProgramAssignmentService,

    TrainingProgramCrudRepository,
    TrainingProgramVersionRepository,
    TrainingProgramAssignmentRepository,
    TrainingProgramExerciseRepository,
    TrainingProgramSetRepository,
    TrainingProgramWorkoutRepository,
  ],
})
export class TrainingProgramsModule {}
